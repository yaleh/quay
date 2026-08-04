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
#   bash plugin/scripts/heavy-op-token.sh --report            # waited_ms distribution (count/median/p90/max)
#   bash plugin/scripts/heavy-op-token.sh --root <dir> ...   # test seam: override the state-dir root
#   bash plugin/scripts/heavy-op-token.sh --events-file <p> ... # test seam: override the events file (default ${PWD}/.quay/heavy-op-token-events.jsonl)
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
#     held duration — silent waiting is indistinguishable from a hang. `--timeout N` is a REAL
#     bounded poll, NOT a single decision: do_acquire re-checks the reclaim conditions once per
#     second, re-attempting the atomic claim each iteration, for at most N seconds — so a dead
#     holder becomes reclaimable mid-wait and the acquire SUCCEEDS. (gap-the-only-token-waiter-
#     refuses-to-wait-at-all AC1 pins this: a --timeout that does not loop would make changing
#     test.sh's bound a "exists but does not take effect" no-op.)
#   - wait bound (gap-the-only-token-waiter-refuses-to-wait-at-all, AC4): the ONLY real waiter is
#     scripts/test.sh, which uses HEAVY_OP_ACQUIRE_TIMEOUT_S (default 40): a full stale-timeout
#     cycle (HEAVY_OP_STALE_TIMEOUT_S, default 30) plus margin for the write→reclaim race, yet FAR
#     below one real heavy op (full suite ~8 min at concurrency 8) — the worst-case wait absorbs
#     the ≤30s transient grace window and can NEVER serialize two heavy ops back-to-back
#     (40/480 ≈ 8% of a full suite).
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
# LAST_BLOCK — the reason the most recent try_acquire failed (holder alive / holder dead-not-stale
# + reclaim delta). Set by try_acquire on each failed claim, surfaced by do_acquire's timeout
# branch so the FINAL failure line names the holder's real state instead of a generic "held".
LAST_BLOCK=""

# ── events landing (gap-token-wait-times-are-printed-once-and-never-landed) ─────────────────────────────
# Every acquire appends one JSONL record to the workspace's `.quay/` runtime-state file — the same
# shape / location / gitignore treatment as gate-events.jsonl (baseline for the concurrency-relaxation
# experiment's third number: the real distribution of waited_ms). The landing is OBSERVATION ONLY:
# a failed write must NEVER change the acquire's exit code (AC4 — the observation mechanism is not a
# new single point of failure for the global single-flight token). Default resolves from the caller's
# CWD (scripts/test.sh and the inner dispatch run from the workspace root); HEAVY_OP_EVENTS_FILE or
# --events-file override it (test seam).
EVENTS_FILE="${HEAVY_OP_EVENTS_FILE:-${PWD}/.quay/heavy-op-token-events.jsonl}"
# A distribution (median/p90/max) is only meaningful past this many samples; below it the report says
# "样本 N 不足" instead of printing a pretty zero (gap-token-wait-times... AC6).
MIN_EVENTS_FOR_DIST=10

# jsonl_escape <value> — make a value safe inside a JSON string literal. This script only writes
# short alphanumeric project tokens in practice; the escape still guards quotes/backslashes/newlines.
jsonl_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r'
}

# land_event <project> <waited_ms> <acquired:yes|no> <outcome> <holder> — append one record,
# swallowing every failure (observation must never block the acquire; AC4's negative control).
land_event() {
  local project="$1" waited_ms="$2" acquired="$3" outcome="$4" holder="$5"
  { mkdir -p "$(dirname "${EVENTS_FILE}")" \
      && printf '{"ts":%s,"project":"%s","waited_ms":%s,"acquired":"%s","holder":"%s","outcome":"%s"}\n' \
         "$(now_ms)" "$(jsonl_escape "${project}")" "$waited_ms" "$acquired" \
         "$(jsonl_escape "${holder}")" "$outcome" >> "${EVENTS_FILE}"; } 2>/dev/null || true
}

now_ms() {
  # Epoch milliseconds from ONE date call. `date +%s%N` yields seconds+nanoseconds from a
  # single clock read. Two separate `date +%s` / `date +%N` calls could straddle a second
  # boundary (seconds from second X, nanos from X+1), synthesizing a timestamp up to ~999ms
  # EARLY — a later reader could then compute an earlier time than an earlier writer, making
  # held_ms negative (observed -559ms under load; constructive defect, not a load artifact).
  # NOTE: `date +%s%3N` is avoided (some builds don't truncate %N and emit full nanoseconds);
  # parsing the first 3 nanosecond digits here is equivalent and keeps that guarantee.
  local out s n
  out="$(date +%s%N 2>/dev/null || echo 0000000000000000000)"
  case "$out" in ''|*[!0-9]*) out="0000000000000000000" ;; esac
  s="${out:0:10}"
  n="${out:10:9}"
  case "$n" in ''|*[!0-9]*) n="000000000" ;; esac
  printf '%s%03d' "${s:-0}" "$(( 10#${n:0:3} ))"
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
    --events-file) EVENTS_FILE="${args[$((i+1))]:-}"; i=$((i+1)) ;;
    --report)  cmd="events-report" ;;
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
    local diff=$(( now - acq ))
    if [ "$diff" -lt 0 ]; then
      # Defensive clamp only. With the single-call now_ms() fix this should never fire; if it
      # does, the clock is actually broken. Say so loudly on stderr instead of silently
      # flattening — a silent clamp would make "held 0ms" a detector with no voice.
      printf 'heavy-op-token: WARNING held_ms computed negative (%sms) — clock went backwards; clamped to 0\n' "$diff" >&2
      diff=0
    fi
    printf '%s' "$diff"
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
      LAST_BLOCK="token held by ${holder:-unknown} (pid ${pid}, ALIVE, held ${held}ms)"
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
      local age=$(( now_s - mtime_s ))
      local reclaim_in=$(( STALE_TIMEOUT_S - age ))
      if [ "$reclaim_in" -lt 0 ]; then reclaim_in=0; fi
      LAST_BLOCK="token held by ${holder:-unknown} (pid ${pid:-?} DEAD, mtime only ${age}s old — reclaimable in ${reclaim_in}s)"
      printf 'heavy-op-token: HELD by %s (pid %s dead, mtime only %ss old) — holder DEAD; reclaimable in %ss (reclaim needs BOTH mtime timeout AND dead pid) — %s did not acquire\n' \
        "${holder:-unknown}" "${pid:-?}" "$age" "$reclaim_in" "$project" >&2
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
  local project="$1" timeout="$2" waited=0 holder_now
  if ! fail_open_or_prepare; then
    printf 'waited_ms=0 holder=<fail-open> acquired=no\n'
    land_event "${project}" "0" "no" "fail-open" "<fail-open>"
    return 0
  fi
  while :; do
    if try_acquire "$project"; then
      printf 'waited_ms=%d holder=%s acquired=yes\n' "$(( waited * 1000 ))" "$project"
      land_event "${project}" "$(( waited * 1000 ))" "yes" "acquired" "${project}"
      return 0
    fi
    if [ "$timeout" -eq 0 ] || [ "$waited" -ge "$timeout" ]; then
      # AC5: the FINAL failure line must say what actually blocks (alive vs dead + reclaim delta),
      # not a generic "held by another project". LAST_BLOCK carries the last try_acquire reason.
      if [ -n "$LAST_BLOCK" ]; then
        printf 'heavy-op-token: did not acquire within %ss wait window — %s — %s did not acquire\n' \
          "$timeout" "$LAST_BLOCK" "$project" >&2
      fi
      # waited_ms is a contract measure — emitted on failure too (how long THIS acquire waited).
      printf 'waited_ms=%d acquired=no\n' "$(( waited * 1000 ))"
      holder_now="$(read_holder)"
      land_event "${project}" "$(( waited * 1000 ))" "no" "timeout" "${holder_now:-unknown}"
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

# ── events report (gap-token-wait-times-are-printed-once-and-never-landed AC6) ──────────────────────────
do_events_report() {
  local file="${EVENTS_FILE}" count=0 vals
  if [ ! -f "${file}" ]; then
    printf 'heavy-op-token-events: no events file at %s (count 0)\n' "${file}"
    return 0
  fi
  count="$(grep -c '^{' "${file}" 2>/dev/null || echo 0)"
  case "$count" in ''|*[!0-9]*) count=0 ;; esac
  if [ "$count" -lt "${MIN_EVENTS_FOR_DIST}" ]; then
    # Refusing a "pretty 0": a median/p90/max over too few samples is noise dressed as signal.
    printf 'heavy-op-token-events: count=%s — 样本 %s 不足 (need >= %s for a distribution); no median/p90/max printed\n' \
      "${count}" "${count}" "${MIN_EVENTS_FOR_DIST}"
    return 0
  fi
  vals="$(grep -o '"waited_ms":[0-9]*' "${file}" | sed 's/^"waited_ms"://' | sort -n)"
  printf '%s' "${vals}" | awk -v n="${count}" '
    { a[NR] = $1 }
    END {
      med = (n % 2) ? a[int(n/2)+1] : int((a[n/2] + a[n/2+1]) / 2);
      p90i = int(n * 0.9) + 1; if (p90i > n) p90i = n;
      printf "heavy-op-token-events: count=%d median_ms=%d p90_ms=%d max_ms=%d\n", n, med, a[p90i], a[n];
    }'
}

case "$cmd" in
  status)  do_status ;;
  acquire) do_acquire "$project" "$timeout" ;;
  release) do_release "$project" ;;
  events-report) do_events_report ;;
esac
