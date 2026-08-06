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
#   bash plugin/scripts/heavy-op-token.sh --renew <project>    # the WORK OWNER re-asserts liveness (lease + pid)
#   bash plugin/scripts/heavy-op-token.sh --release <project>
#   bash plugin/scripts/heavy-op-token.sh --report            # waited_ms distribution (count/median/p90/max)
#   bash plugin/scripts/heavy-op-token.sh --root <dir> ...   # test seam: override the state-dir root
#   bash plugin/scripts/heavy-op-token.sh --events-file <p> ... # test seam: override the events file (default ${PWD}/.quay/heavy-op-token-events.jsonl)
#
# LEASE + RENEW (gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs):
#   The token's holder identity was "the shell that acquired it", but the WORK can live in a different
#   process (archguard's retry loop: `timeout 590 npx vitest run --coverage` in a loop — every `timeout`
#   kills the attempt shell that holds the token, while the retry loop keeps running in a NEW shell).
#   So a liveness signal derived from the recorded pid watches the WRONG process: pid dead + mtime stale
#   made the token reclaimable while the work was still going (AC1 reproduction; stale_reclaims 17→20).
#   No process identifier can represent "the work": pid dies with each attempt, pgid does not span
#   attempts, session is too coarse (whole-project, always alive). The ONLY entity that knows whether the
#   work continues is the retry loop itself. So the token stops guessing and ASKS IT:
#
#     - LEASE: `--acquire` writes `lease_expires_ms = now + HEAVY_OP_LEASE_S` (default 3600s). A token is
#       reclaimable at lease expiry — a TIME signal, not a pid guess. No renew ⇒ lease expires ⇒ token
#       releases: the failure direction is safe (identical to today for a holder that simply finishes or
#       crashes — never worse, AC3 negative control).
#     - RENEW: `--renew <project>` is the ONE-LINE caller change. The retry loop calls it between
#       attempts (the loop is the only entity that knows the work continues, so it — not the token — is
#       responsible for saying "still here"). It re-binds the token's pid to the RENEWING process (the
#       work owner) AND extends the lease. With the pid re-bound to the work owner, pid-alive now tracks
#       the work, not the attempt shell.
#     - pid death is demoted to an ACCELERATED RELEASE, not the sole basis: pid dead + mtime past the
#       stale grace (HEAVY_OP_STALE_TIMEOUT_S) reclaims EARLY even while the lease is still valid — this
#       preserves today's verified 20× crash-reclaim behavior (AC4). pid death alone is never enough; a
#       renewing holder (fresh lease, fresh mtime) is protected (AC2).
#
#   Why the responsibility is on the retry loop, not the token (AC5): a "record the real working pid"
#   design would require the caller to report the work AFTER it starts, leaving an unprotected window and
#   silently degrading if the report is missing. A lease does the opposite — the default is release, and
#   the work owner must actively renew to keep it. If the renew is missed, the token releases = today's
#   behavior; if the work is truly still running, the loop's own `--renew` is what keeps the mutex.
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
#   - reclaim, in priority order (try_acquire):
#       * a LIVE pid is held UNLESS the lease has expired — a live holder is never stolen on mtime alone
#         (protects long-running one-shot holders), but a live holder that never renews or releases is
#         reclaimable at lease expiry (the anti-hang backstop — AC3's "not permanently locked out").
#       * pid DEAD + mtime older than HEAVY_OP_STALE_TIMEOUT_S ⇒ reclaim EARLY (accelerated release;
#         today's verified 20× crash-reclaim behavior, AC4) — even while the lease is still valid.
#       * pid DEAD + lease expired ⇒ reclaim (the primary lease path, AC3).
#       * pid DEAD + lease valid + mtime fresh ⇒ HELD (the retry loop just crashed between attempts and
#         may renew — the AC2 grace window).
#       * legacy token (no lease_expires_ms field) falls back to the OLD rule: mtime stale AND pid dead.
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
# Test seams (env): QUAY_GLOBAL_DIR (or --root), HEAVY_OP_STALE_TIMEOUT_S (default 30),
# HEAVY_OP_LEASE_S (default 3600 = 1h lease).

set -euo pipefail

# ── state location (outside every repo) ─────────────────────────────────────────────────────────────
GLOBAL_DIR="${QUAY_GLOBAL_DIR:-${HOME:-/tmp}/.quay-global}"
HEAVY_OP_DIR="${GLOBAL_DIR}/heavy-op"
TOKEN_FILE="${HEAVY_OP_DIR}/token"
RECLAIM_COUNTER="${HEAVY_OP_DIR}/stale_reclaims"
STALE_TIMEOUT_S="${HEAVY_OP_STALE_TIMEOUT_S:-30}"
# LEASE duration: how long a holder is guaranteed exclusive without renewing. Default 1h — FAR above a
# one-shot heavy op (full suite ~8 min) so a non-renewing holder never hits it; the anti-hang backstop
# for a live-but-abandoned holder; and crash recovery does NOT wait for it (the pid-dead + mtime-stale
# accelerated path reclaims in ~30s, AC4). The retry loop extends it via --renew.
HEAVY_OP_LEASE_S="${HEAVY_OP_LEASE_S:-3600}"
LEASE_MS=$(( HEAVY_OP_LEASE_S * 1000 ))
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
    --renew)   cmd="renew";   project="${args[$((i+1))]:-}"; i=$((i+1)) ;;
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
    printf 'usage: heavy-op-token.sh --status | --acquire <project> [--timeout <s>] | --renew <project> | --release <project>\n' >&2
    exit 2
    ;;
esac
if [ "$cmd" = "acquire" ] || [ "$cmd" = "renew" ] || [ "$cmd" = "release" ]; then
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
read_lease()      { read_field lease_expires_ms; }

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

# classify_hold <pid> <lease> <now_ms> <mtime_s> — classify a held token into the acquire path's
# decision inputs. Sets globals, SHARED by try_acquire's reclaim decision and do_status's honest
# read-only report so `reclaimable_now` always matches what the next --acquire will actually do
# (gap-token-status-reports-a-dead-holder-as-busy — a status read that disagrees with acquire is the
# exact "存在≠生效" defect this closes):
#   HOLD_PID_ALIVE   0|1  pid exists, non-zombie (kill -0 + /proc state)
#   HOLD_MTIME_AGE   mtime age in seconds
#   HOLD_MTIME_STALE 0|1  mtime age >= HEAVY_OP_STALE_TIMEOUT_S
#   HOLD_LEASE_PRESENT 0|1  token carries a numeric lease_expires_ms
#   HOLD_LEASE_VALID   0|1  lease present AND now < lease
#   HOLD_LEASE_EXPIRED 0|1  lease present AND now >= lease
#   HOLD_RECLAIMABLE   0|1  would try_acquire reclaim this token right now?
#   HOLD_REASON         human reason for HOLD_RECLAIMABLE ("" when not reclaimable)
# Reclaim decision (gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs):
#   * live pid            → HELD, unless the lease has expired (anti-hang backstop, AC3).
#   * dead pid + stale mt → reclaim EARLY (accelerated release, AC4) even while the lease is valid.
#   * dead pid + expired  → reclaim (primary lease path, AC3).
#   * dead pid + valid lease + fresh mtime → HELD (the AC2 grace window — the work may renew).
#   * legacy token (no lease field) → the OLD rule: reclaim iff mtime stale AND pid dead.
classify_hold() {
  local pid="$1" lease="$2" now_ms_v="$3" mtime_s_v="$4"
  HOLD_PID_ALIVE=0; HOLD_MTIME_AGE=0; HOLD_MTIME_STALE=0
  HOLD_LEASE_PRESENT=0; HOLD_LEASE_VALID=0; HOLD_LEASE_EXPIRED=0
  HOLD_RECLAIMABLE=0; HOLD_REASON=""
  if [ -n "$pid" ] && pid_alive "$pid"; then HOLD_PID_ALIVE=1; fi
  HOLD_MTIME_AGE=$(( (now_ms_v / 1000) - mtime_s_v ))
  if [ "$HOLD_MTIME_AGE" -ge "${STALE_TIMEOUT_S}" ]; then HOLD_MTIME_STALE=1; fi
  case "$lease" in
    ''|*[!0-9]*) HOLD_LEASE_PRESENT=0 ;;
    *)
      HOLD_LEASE_PRESENT=1
      if [ "$now_ms_v" -lt "$lease" ]; then HOLD_LEASE_VALID=1; else HOLD_LEASE_EXPIRED=1; fi
      ;;
  esac
  if [ "$HOLD_PID_ALIVE" = "1" ]; then
    # A LIVE holder is never stolen on mtime/pid grounds; only an expired lease reclaims it (the
    # anti-hang backstop — a live holder that never renews or releases is reclaimable, AC3).
    if [ "$HOLD_LEASE_PRESENT" = "1" ] && [ "$HOLD_LEASE_EXPIRED" = "1" ]; then
      HOLD_RECLAIMABLE=1; HOLD_REASON="lease expired (pid ${pid} alive)"
    fi
  else
    if [ "$HOLD_MTIME_STALE" = "1" ]; then
      # Accelerated release: dead pid + stale mtime reclaims EARLY, even with a valid lease (AC4).
      HOLD_RECLAIMABLE=1; HOLD_REASON="pid ${pid:-?} not alive + mtime ${HOLD_MTIME_AGE}s old"
    elif [ "$HOLD_LEASE_EXPIRED" = "1" ]; then
      # Primary lease path: dead pid + lease expired ⇒ reclaim (AC3).
      HOLD_RECLAIMABLE=1; HOLD_REASON="lease expired (pid ${pid:-?} not alive)"
    fi
  fi
}

# try_acquire <project> — one atomic claim attempt. 0 = acquired; 1 = held/stale-but-not-reclaimable.
# Prints holder identity + held duration to stderr on failure (the control contract).
try_acquire() {
  local project="$1" holder pid lease now mtime_s held reclaim_in
  if [ -e "${TOKEN_FILE}" ]; then
    holder="$(read_holder)"
    pid="$(read_holder_pid)"
    lease="$(read_lease)"
    now="$(now_ms)"
    mtime_s="$(token_mtime_s)"

    # Single shared classification (see classify_hold) so the reclaim decision and --status's
    # honest report can never disagree.
    classify_hold "$pid" "$lease" "$now" "$mtime_s"

    if [ "$HOLD_RECLAIMABLE" = "1" ]; then
      rm -f "${TOKEN_FILE}"
      bump_reclaim_counter
      printf 'heavy-op-token: RECLAIMED stale token (%s) — reclaim #%s\n' \
        "$HOLD_REASON" "$(read_reclaim_counter)" >&2
    else
      held="$(held_ms_of_token)"
      if [ "$HOLD_PID_ALIVE" = "1" ]; then
        LAST_BLOCK="token held by ${holder:-unknown} (pid ${pid}, ALIVE, held ${held}ms)"
        printf 'heavy-op-token: HELD by %s (pid %s, held %sms) — %s did not acquire (no silent wait)\n' \
          "${holder:-unknown}" "$pid" "$held" "$project" >&2
      else
        local reclaim_in=$(( STALE_TIMEOUT_S - HOLD_MTIME_AGE ))
        if [ "$reclaim_in" -lt 0 ]; then reclaim_in=0; fi
        LAST_BLOCK="token held by ${holder:-unknown} (pid ${pid:-?} DEAD, mtime only ${HOLD_MTIME_AGE}s old — reclaimable in ${reclaim_in}s)"
        printf 'heavy-op-token: HELD by %s (pid %s dead, mtime only %ss old) — holder DEAD; reclaimable in %ss (reclaim needs a lease expiry OR a stale-mtime grace AND a dead pid) — %s did not acquire\n' \
          "${holder:-unknown}" "${pid:-?}" "$HOLD_MTIME_AGE" "$reclaim_in" "$project" >&2
      fi
      return 1
    fi
  fi
  # atomic wx-create: noclobber redirect = O_CREAT|O_EXCL (the Land-lock pattern, bash spelling).
  local claimed=0 now_once
  set -o noclobber
  now_once="$(now_ms)"
  if printf 'holder=%s\npid=%s\nacquired_ms=%s\nlease_expires_ms=%s\nhost=%s\n' \
      "$project" "$PPID" "$now_once" "$(( now_once + LEASE_MS ))" "$(hostname 2>/dev/null || echo unknown)" > "${TOKEN_FILE}" 2>/dev/null; then
    claimed=1
  fi
  set +o noclobber
  [ "$claimed" = "1" ]
}

# ── subcommands ───────────────────────────────────────────────────────────────────────────────────────
do_status() {
  local holder pid held lease lease_remaining now_now
  if ! fail_open_or_prepare; then
    printf 'holder=none\nheld_ms=n/a\nholder_alive=n/a\nreclaimable_now=n/a\nstale_reclaims=%s\n' "$(read_reclaim_counter)"
    return 0
  fi
  if [ ! -e "${TOKEN_FILE}" ]; then
    printf 'holder=none\nheld_ms=n/a\nholder_alive=n/a\nreclaimable_now=n/a\nstale_reclaims=%s\n' "$(read_reclaim_counter)"
    return 0
  fi
  holder="$(read_holder)"
  pid="$(read_holder_pid)"
  held="$(held_ms_of_token)"
  lease="$(read_lease)"
  # lease_remaining_ms: ms until the lease expires (clamped ≥ 0); "n/a" for a legacy token.
  lease_remaining="n/a"
  case "$lease" in
    ''|*[!0-9]*) lease_remaining="n/a" ;;
    *)
      local diff=$(( lease - $(now_ms) ))
      if [ "$diff" -lt 0 ]; then diff=0; fi
      lease_remaining="$diff"
      ;;
  esac

  # Dead-holder honesty (gap-token-status-reports-a-dead-holder-as-busy): a --status that reports a
  # dead holder as "busy" is a LYING read — it makes a human arbitrator yield to work that is not
  # running (the 19-minute dead-holder tick, 2026-08-03). Report holder_alive (consistent with
  # kill -0, the Contract's band) AND whether the next --acquire would reclaim per the acquire path's
  # OWN criteria (reclaimable_now, AC5). The classification is SHARED with try_acquire, so this read's
  # answer always matches what the next acquire will do. The read stays READ-ONLY — it must never
  # reclaim (AC4): observing a state must not mutate it (the --report deadlock lesson).
  now_now="$(now_ms)"
  classify_hold "$pid" "$lease" "$now_now" "$(token_mtime_s)"

  local alive reclaim
  if [ "$HOLD_PID_ALIVE" = "1" ]; then alive="yes"; else alive="no"; fi
  if [ "$HOLD_RECLAIMABLE" = "1" ]; then reclaim="yes"; else reclaim="no"; fi

  printf 'holder=%s\npid=%s\nheld_ms=%s\nlease_expires_ms=%s\nlease_remaining_ms=%s\nholder_alive=%s\nreclaimable_now=%s\nstale_reclaims=%s\n' \
    "${holder:-unknown}" "${pid:-?}" "${held:-0}" "${lease:-n/a}" "$lease_remaining" "$alive" "$reclaim" "$(read_reclaim_counter)"

  if [ "$HOLD_PID_ALIVE" != "1" ]; then
    # Dead holder: name it plainly (AC3), say whether the next acquire reclaims (AC5), and warn that
    # polling --status for a free slot is an INVALID strategy (AC7) — reclaim is PULL-based, it only
    # happens at --acquire, so a poller waiting for this to "become free" waits forever. Advisory text
    # goes to stderr; the machine fields stay on stdout.
    printf 'heavy-op-token: WARNING holder pid %s is DEAD — the token is held by a dead process\n' "${pid:-?}" >&2
    if [ "$HOLD_RECLAIMABLE" = "1" ]; then
      printf 'heavy-op-token: reclaimable per acquire criteria (%s) — the next --acquire will reclaim automatically, no manual intervention\n' "$HOLD_REASON" >&2
    else
      local reclaim_in=$(( STALE_TIMEOUT_S - HOLD_MTIME_AGE ))
      if [ "$reclaim_in" -lt 0 ]; then reclaim_in=0; fi
      printf 'heavy-op-token: NOT yet reclaimable per acquire criteria (pid dead; mtime only %ss old, stale timeout %ss) — reclaimable in ~%ss (or at lease expiry)\n' \
        "$HOLD_MTIME_AGE" "${STALE_TIMEOUT_S}" "$reclaim_in" >&2
    fi
    printf 'heavy-op-token: reclaim is PULL-based — it happens ONLY at --acquire; polling --status for the slot to become free will NEVER succeed\n' >&2
    printf 'heavy-op-token: run: bash plugin/scripts/heavy-op-token.sh --acquire <project> --timeout <s>   (reclaims + acquires immediately when reclaimable_now=yes)\n' >&2
  fi
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

# do_renew <project> — the WORK OWNER re-asserts liveness (gap-the-token-watches-the-shell-that-asked-
# not-the-work-that-runs). Called by the retry loop between attempts: re-binds the token's pid to the
# renewing process (the entity that actually knows the work continues) and extends the lease. The
# holder field must match (only the holder project renews its own token). A missing token or a
# mismatched holder is a FAILURE (return 1) — the work owner must notice it lost the mutex.
do_renew() {
  local project="$1" holder acq new_expires tmp
  if ! fail_open_or_prepare; then
    printf 'heavy-op-token: renew FAIL-OPEN (state dir not writable) — no-op\n' >&2
    return 0
  fi
  if [ ! -e "${TOKEN_FILE}" ]; then
    printf 'heavy-op-token: renew: no token held — %s cannot renew (the mutex is free or was reclaimed)\n' "$project" >&2
    return 1
  fi
  holder="$(read_holder)"
  if [ "${holder:-}" != "$project" ]; then
    printf 'heavy-op-token: renew: token held by %s, not %s — NOT renewing\n' "${holder:-unknown}" "$project" >&2
    return 1
  fi
  acq="$(read_field acquired_ms)"
  case "$acq" in ''|*[!0-9]*) acq="$(now_ms)" ;; esac
  new_expires="$(( $(now_ms) + LEASE_MS ))"
  # Atomic rewrite: temp file in the same dir + rename. Keeps acquired_ms (held_ms stays continuous);
  # refreshes pid to the RENEWING process (the work owner) and the lease.
  tmp="${TOKEN_FILE}.renew.$$"
  if printf 'holder=%s\npid=%s\nacquired_ms=%s\nlease_expires_ms=%s\nhost=%s\n' \
      "$project" "$PPID" "$acq" "$new_expires" "$(hostname 2>/dev/null || echo unknown)" > "${tmp}" 2>/dev/null; then
    # TOCTOU guard (adversarial review): the holder was read above; between that read and this rename the
    # token may have been reclaimed + re-acquired by another project. Re-check the holder IMMEDIATELY
    # before the atomic rename so a stale renew cannot clobber a freshly-acquired token.
    if [ "$(read_holder)" = "$project" ] && mv -f "${tmp}" "${TOKEN_FILE}" 2>/dev/null; then
      printf 'heavy-op-token: renewed (project=%s, pid=%s, lease extended +%ss, expires in %ss)\n' \
        "$project" "$PPID" "${HEAVY_OP_LEASE_S}" "${HEAVY_OP_LEASE_S}"
      return 0
    fi
  fi
  rm -f "${tmp}"
  printf 'heavy-op-token: renew FAILED to rewrite the token (project=%s)\n' "$project" >&2
  return 1
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
  renew)   do_renew "$project" ;;
  release) do_release "$project" ;;
  events-report) do_events_report ;;
esac
