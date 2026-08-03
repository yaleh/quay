#!/usr/bin/env bash
# plugin/scripts/heavy-op-token.sh — ONE cross-project token for heavy operations
# (gap-loop-mechanism-lives-outside-the-package-and-cannot-ship: moved here from scripts/; all
#  callers now use this canonical path — no old-path shim left behind)
# (gap-no-cross-project-heavy-op-token).
#
# WHY (the failure mode this closes): three projects share four cores — quay's `scripts/test.sh`
# (node --test), archguard's `npm test` (vitest), meta-cc's `make test` (go test). An agent
# WATCHING is a soft invariant: "the outer layer says don't push, wait for authorization" bound only
# the outer layer's own behavior — the inner layer pushed twice, because that boundary lived in one
# agent's behavior, not in a mechanism nobody can bypass. A token is a hard invariant (截断状态空间).
#
# WHAT IT GATES: the single action "I am about to start a heavy test" — independent of WHICH runner
# each project uses. Each runner's internal concurrency stays its own business (the token is NOT a
# node-suite gate).
#
# THIS IS A SCHEDULING TOKEN, NOT A SAFETY CHECK. It deliberately FAILS OPEN (exit 0 + a loud
# marker) when the state dir is unwritable/unreachable: a fail-closed token would stop all three
# projects and cannot self-recover; a fail-open one costs one re-acquirable contention. (Contrast
# plugin/scripts/resource-gate.sh, which FAILS CLOSED on an unmeasurable signal — that IS a safety check.)
# AC5 pins BOTH paths: fail-open when unwritable, and normal mutual exclusion after recovery.
#
# STATE LIVES OUTSIDE EVERY REPO: ${QUAY_GLOBAL_DIR:-$HOME/.quay-global}/heavy-op/ — shared by all
# three projects; deleting any one repo cannot delete the others' tokens.
#
# Usage:
#   bash plugin/scripts/heavy-op-token.sh --status
#   bash plugin/scripts/heavy-op-token.sh --acquire <project> [--timeout <s>]
#   bash plugin/scripts/heavy-op-token.sh --release <project>
#   bash plugin/scripts/heavy-op-token.sh --root <dir> ...   # test seam: override the state-dir root
#
# Contract (from the task's ## Contract block):
#   measure  holder   = `--status` 的 holder 字段
#   measure  wait_ms  = `--acquire <project>` 输出的 waited_ms 字段
#   measure  reclaims = `--status` 的 stale_reclaims 字段
#   band     concurrent_holders = 1
#   invoke   `bash plugin/scripts/heavy-op-token.sh --acquire quay --timeout 0`
#   control  A 持有时 B --acquire ⇒ B 失败且打印 A 的身份与已持有时长；A --release 后 B 成功
#
# MECHANISM:
#   - acquire = atomic `wx`-create (the bash spelling of the Land-lock pattern CLAUDE.md records):
#     `set -o noclobber` + redirect = O_CREAT|O_EXCL. Nobody can bypass a created token.
#   - heartbeat: the HOLDER touches the token file periodically (a live holder's mtime stays fresh).
#   - stale reclaim = mtime older than HEAVY_OP_STALE_TIMEOUT_S **AND** the holder pid not alive.
#     BOTH must hold — reclaiming on mtime alone would kill a legitimately long-running holder (the
#     pid-alive check is what protects it); reclaiming on pid-death alone would not distinguish a
#     crashed holder from pid reuse (the mtime guard is the other half).
#   - no silent wait: `--timeout 0` (the default) fails IMMEDIATELY with the holder's identity and
#     held duration — silent waiting is indistinguishable from a hang. `--timeout N` polls at most N
#     seconds, printing a line each second so the caller can see it is waiting.
#   - no fair queue / FIFO: starvation is observable first (waited_ms), the policy decision waits
#     for cost data — setting policy before the cost structure is known is the 416s mistake.
#
# Test seams (env): QUAY_GLOBAL_DIR (or --root), HEAVY_OP_STALE_TIMEOUT_S (default 30).

set -euo pipefail

# ── state location (outside every repo) ─────────────────────────────────────────────────────────────
GLOBAL_DIR="${QUAY_GLOBAL_DIR:-${HOME:-/tmp}/.quay-global}"
HEAVY_OP_DIR="${GLOBAL_DIR}/heavy-op"
TOKEN_FILE="${HEAVY_OP_DIR}/token"
RECLAIM_COUNTER="${HEAVY_OP_DIR}/stale_reclaims"
STALE_TIMEOUT_S="${HEAVY_OP_STALE_TIMEOUT_S:-30}"

now_ms() {
  # Epoch milliseconds. NOT `date +%s%3N`: some date builds do not truncate %N (this box emits
  # full nanoseconds, and %N is not zero-padded), which makes held_ms garbage. Build it from
  # seconds + the first 3 nanosecond digits, left-padded to 3.
  local s n
  s="$(date +%s 2>/dev/null || echo 0)"
  n="$(date +%N 2>/dev/null || echo 000000000)"
  case "$n" in ''|*[!0-9]*) n="000000000" ;; esac
  printf '%s%03d' "$s" "$(( 10#${n:0:3} ))"
}

# ── argument parsing ─────────────────────────────────────────────────────────────────────────────────
cmd=""
project=""
timeout=0
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  a="${args[$i]}"
  case "$a" in
    --acquire) cmd="acquire"; project="${args[$((i+1))]:-}"; i=$((i+1)) ;;
    --release) cmd="release"; project="${args[$((i+1))]:-}"; i=$((i+1)) ;;
    --status)  cmd="status" ;;
    --timeout) timeout="${args[$((i+1))]:-0}"; i=$((i+1)) ;;
    --root)    GLOBAL_DIR="${args[$((i+1))]:-}"; HEAVY_OP_DIR="${GLOBAL_DIR}/heavy-op"; TOKEN_FILE="${HEAVY_OP_DIR}/token"; RECLAIM_COUNTER="${HEAVY_OP_DIR}/stale_reclaims"; i=$((i+1)) ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'heavy-op-token: unknown argument: %s\n' "$a" >&2; exit 2 ;;
  esac
  i=$((i+1))
done

case "$cmd" in
  "")
    printf 'usage: heavy-op-token.sh --status | --acquire <project> [--timeout <s>] | --release <project>\n' >&2
    exit 2
    ;;
esac
if [ "$cmd" = "acquire" ] || [ "$cmd" = "release" ]; then
  if [ -z "$project" ]; then
    printf 'heavy-op-token: %s requires a project id\n' "--$cmd" >&2
    exit 2
  fi
fi
case "$timeout" in
  ''|*[!0-9]*) printf 'heavy-op-token: --timeout must be a non-negative integer\n' >&2; exit 2 ;;
esac

# ── helpers ───────────────────────────────────────────────────────────────────────────────────────────

# read_field <key> — read `key=value` from the token file (empty when absent/malformed).
read_field() {
  local key="$1"
  awk -F= -v k="$key" '$1==k{print substr($0, index($0,"=")+1); exit}' "${TOKEN_FILE}" 2>/dev/null || true
}
read_holder()     { read_field holder; }
read_holder_pid() { read_field pid; }

# pid_alive <pid> — 0 iff the pid exists AND is not a zombie (a zombie cannot heartbeat/release).
pid_alive() {
  local p="$1" st
  [ -n "$p" ] && [ "$p" != "0" ] || return 1
  kill -0 "$p" 2>/dev/null || return 1
  st="$(awk '{print $3}' "/proc/$p/stat" 2>/dev/null || true)"
  [ "${st:-}" != "Z" ]
}

token_mtime_s() {
  stat -c %Y "${TOKEN_FILE}" 2>/dev/null || stat -f %m "${TOKEN_FILE}" 2>/dev/null || echo 0
}

# held_ms_of_token — milliseconds since the token's acquired_ms.
held_ms_of_token() {
  local acq now
  acq="$(read_field acquired_ms)"
  now="$(now_ms)"
  if [ -n "$acq" ] && [ "$acq" -ge 0 ] 2>/dev/null; then
    printf '%s' "$(( now - acq ))"
  else
    printf '0'
  fi
}

# fail_open_or_prepare — ensure the state dir exists + is writable. On unwritable/unreachable,
# print the LOUD marker and return 1 (the caller then FAILS OPEN — scheduling token, not a safety
# check). A fail-closed token would stop all three projects and cannot self-recover.
fail_open_or_prepare() {
  if ! mkdir -p "${HEAVY_OP_DIR}" 2>/dev/null || [ ! -w "${HEAVY_OP_DIR}" ]; then
    printf '\n==============================================\n'
    printf 'HEAVY-OP-TOKEN FAIL-OPEN: %s\n' "${HEAVY_OP_DIR}"
    printf '  is not writable/reachable. Proceeding WITHOUT the cross-project mutex.\n'
    printf '  This is a scheduling token, not a safety check — a fail-closed token would stop\n'
    printf '  all three projects and cannot self-recover; failing open costs one re-acquirable\n'
    printf '  contention. Fix $QUAY_GLOBAL_DIR (or --root) to restore mutual exclusion.\n'
    printf '==============================================\n'
    return 1
  fi
  return 0
}

# bump_reclaim_counter — persist one stale reclaim (survives token-file replacement).
bump_reclaim_counter() {
  local n=0
  if [ -f "${RECLAIM_COUNTER}" ]; then
    n="$(cat "${RECLAIM_COUNTER}" 2>/dev/null || echo 0)"
    case "$n" in ''|*[!0-9]*) n=0 ;; esac
  fi
  printf '%s\n' "$(( n + 1 ))" > "${RECLAIM_COUNTER}"
}

read_reclaim_counter() {
  local n
  n="$(cat "${RECLAIM_COUNTER}" 2>/dev/null || echo 0)"
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
  printf '%s' "$n"
}

# try_acquire <project> — one atomic claim attempt. 0 = acquired; 1 = held/stale-but-not-reclaimable.
# Prints holder identity + held duration to stderr on failure (the control contract).
try_acquire() {
  local project="$1" holder pid mtime_s now_s held
  if [ -e "${TOKEN_FILE}" ]; then
    holder="$(read_holder)"
    pid="$(read_holder_pid)"
    if [ -n "$pid" ] && pid_alive "$pid"; then
      held="$(held_ms_of_token)"
      printf 'heavy-op-token: HELD by %s (pid %s, held %sms) — %s did not acquire (no silent wait)\n' \
        "${holder:-unknown}" "$pid" "$held" "$project" >&2
      return 1
    fi
    mtime_s="$(token_mtime_s)"
    now_s="$(date +%s)"
    if [ "$(( now_s - mtime_s ))" -ge "${STALE_TIMEOUT_S}" ]; then
      rm -f "${TOKEN_FILE}"
      bump_reclaim_counter
      printf 'heavy-op-token: RECLAIMED stale token (mtime %ss old, pid %s not alive) — reclaim #%s\n' \
        "$(( now_s - mtime_s ))" "${pid:-?}" "$(read_reclaim_counter)" >&2
    else
      held="$(held_ms_of_token)"
      printf 'heavy-op-token: HELD by %s (pid %s dead, mtime only %ss old) — NOT stale: reclaim needs BOTH mtime timeout AND dead pid — %s did not acquire\n' \
        "${holder:-unknown}" "${pid:-?}" "$(( now_s - mtime_s ))" "$project" >&2
      return 1
    fi
  fi
  # atomic wx-create: noclobber redirect = O_CREAT|O_EXCL (the Land-lock pattern, bash spelling).
  local claimed=0
  set -o noclobber
  if printf 'holder=%s\npid=%s\nacquired_ms=%s\nhost=%s\n' \
      "$project" "$PPID" "$(now_ms)" "$(hostname 2>/dev/null || echo unknown)" > "${TOKEN_FILE}" 2>/dev/null; then
    claimed=1
  fi
  set +o noclobber
  [ "$claimed" = "1" ]
}

# ── subcommands ───────────────────────────────────────────────────────────────────────────────────────
do_status() {
  local holder pid held
  if ! fail_open_or_prepare; then
    printf 'holder=none\nheld_ms=n/a\nstale_reclaims=%s\n' "$(read_reclaim_counter)"
    return 0
  fi
  if [ ! -e "${TOKEN_FILE}" ]; then
    printf 'holder=none\nheld_ms=n/a\nstale_reclaims=%s\n' "$(read_reclaim_counter)"
    return 0
  fi
  holder="$(read_holder)"
  pid="$(read_holder_pid)"
  held="$(held_ms_of_token)"
  printf 'holder=%s\npid=%s\nheld_ms=%s\nstale_reclaims=%s\n' \
    "${holder:-unknown}" "${pid:-?}" "${held:-0}" "$(read_reclaim_counter)"
}

do_acquire() {
  local project="$1" timeout="$2" waited=0
  if ! fail_open_or_prepare; then
    printf 'waited_ms=0 holder=<fail-open> acquired=no\n'
    return 0
  fi
  while :; do
    if try_acquire "$project"; then
      printf 'waited_ms=%d holder=%s acquired=yes\n' "$(( waited * 1000 ))" "$project"
      return 0
    fi
    if [ "$timeout" -eq 0 ] || [ "$waited" -ge "$timeout" ]; then
      # waited_ms is a contract measure — emitted on failure too (how long THIS acquire waited).
      printf 'waited_ms=%d acquired=no\n' "$(( waited * 1000 ))"
      return 1
    fi
    waited=$((waited + 1))
    printf 'heavy-op-token: token held — waited %ss (bounded wait, not silent)...\n' "$waited" >&2
    sleep 1
  done
}

do_release() {
  local project="$1" token_pid
  if ! fail_open_or_prepare; then
    printf 'heavy-op-token: release FAIL-OPEN (state dir not writable) — no-op\n' >&2
    return 0
  fi
  if [ ! -e "${TOKEN_FILE}" ]; then
    printf 'heavy-op-token: release: no token held (idempotent no-op)\n'
    return 0
  fi
  token_pid="$(read_holder_pid)"
  if [ -n "$token_pid" ] && [ "$token_pid" = "$PPID" ]; then
    rm -f "${TOKEN_FILE}"
    printf 'heavy-op-token: released (project=%s, pid=%s)\n' "${project:-?}" "$PPID"
    return 0
  fi
  printf 'heavy-op-token: release: token held by pid %s, not us (%s) — NOT releasing (idempotent no-op)\n' \
    "${token_pid:-unknown}" "$PPID" >&2
  return 0
}

case "$cmd" in
  status)  do_status ;;
  acquire) do_acquire "$project" "$timeout" ;;
  release) do_release "$project" ;;
esac
