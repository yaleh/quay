#!/usr/bin/env bash
# closure-lag-check.sh — the closure-pass lag signal (tasks/gap-closure-pass-has-no-lag-signal).
# The outer's async closure pass ("### 1b. 异步收尾例程", the verification-round closure pass) flips
# implemented ready-tasks to done. It had NO lag signal: a "forced, every-tick" step could silently
# stop running for hours and nothing would report it (observed 2026-08-09: 8.5h of no outer:close,
# not-yet-flipped climbing to 42/51 = 82% — AC23 only checks the tick HEARTBEAT, not whether the
# forced steps INSIDE the tick ran).
#
# CROSS-ANNOTATION (task gap-spec-p2-quad-tuple-unified-emitter, candidate A):
# this script is the closure-lag SIGNAL + TRACE WRITER (one mechanism in the SPEC §2.5 ledger
# four-tuple's ①「声称机制的最近真实执行时刻」— its trace `.quay/closure-pass-last-run.json` is one
# of the on-disk traces the unified four-tuple emitter reads). The UNIFIED four-tuple emitter is
# `plugin/scripts/accounting-emit.ts` (all three layers call it); this script stays the outer's
# closure-lag signal, and the emitter's outer mechanism registry reads this script's trace for the
# closure-pass's last real execution time. Candidate B (extending this script into the four-tuple
# emitter) was NOT taken — the emitter is a separate, layer-identical script so the format is shared
# by construction.
#
# THE SIGNAL (## Contract band: non-zero = 报出; normal = 0 silent). Two independent conditions,
# either fires ⇒ exit 1:
#   1. not-yet-flipped backlog too large — ready-pool-check's excluded[] count of tasks whose work
#      has LANDED but whose status is still `ready` exceeds --threshold (default 30, per the task
#      Proposal "超阈值（如 >30）即报"). Reuses the existing probe — never reimplements the count.
#   2. closure-pass overdue — the last closure-pass trace (.quay/closure-pass-last-run.json) is
#      older than --timeout seconds (default 3600 = 1h), or is MISSING while there is pending closure
#      work (a closure-pass that never ran with tasks awaiting closure IS a lag).
#
# THE TRACE (## Contract invariant closure_pass_leaves_trace = 1): every closure-pass execution
# writes .quay/closure-pass-last-run.json via `--record --flipped <N>` (timestamp + flip count).
# This script is BOTH the trace writer (--record) and the signal consumer (measure-only / --json).
#
# The signal is a REPORT, never a gate: it does not block dispatch or the tick. Normal state exits 0
# silent; a firing condition prints a CLOSURE-LAG-WARN line (stdout) and exits 1.
#
# Usage:
#   closure-lag-check.sh [--threshold <N>] [--timeout <secs>] [--root <dir>]
#                        [--json] [--record --flipped <N>] [--help]
#
#   (no args)      measure-only: compute the closure-lag signal. 0 = silent, 1 = signal, 2 = error.
#   --threshold N  not-yet-flipped backlog threshold (default 30; strictly > threshold fires).
#   --timeout S    closure-pass max age before the overdue signal (default 3600s = 1h).
#   --root DIR     workspace root (default: auto-derived from this script's location).
#   --json         measure-only, machine-readable JSON (never mutates).
#   --record       write the closure-pass trace (requires --flipped <N>). Creates .quay/ if absent.
#   --flipped N    how many tasks this closure pass flipped (with --record).
#
# Exit codes:
#   0  normal (no lag; or --record / --json success with signal=false)
#   1  closure-lag signal fired (not-yet-flipped > threshold, closure-pass overdue, or trace missing
#      with pending work) — also --json with signal=true
#   2  usage / environment error (no node, no workspace, bad args)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$SCRIPT_DIR/../.." && pwd)"
threshold="30"
timeout="3600"
mode="measure"
flipped=""
root_arg=""

usage() { sed -n 's/^# \{0,1\}//p' "$0" | grep -v '^!' ; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --threshold) threshold="${2:-}"; shift 2 ;;
    --timeout) timeout="${2:-}"; shift 2 ;;
    --root) root_arg="${2:-}"; shift 2 ;;
    --json) mode="json"; shift ;;
    --record) mode="record"; shift ;;
    --flipped) flipped="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "closure-lag-check: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "${threshold}" ] || { echo "closure-lag-check: empty --threshold" >&2; exit 2; }
[ -n "${timeout}" ] || { echo "closure-lag-check: empty --timeout" >&2; exit 2; }
case "${threshold}" in ''|*[!0-9]*) echo "closure-lag-check: --threshold must be a non-negative integer: ${threshold}" >&2; exit 2 ;; esac
case "${timeout}" in ''|*[!0-9]*) echo "closure-lag-check: --timeout must be a non-negative integer: ${timeout}" >&2; exit 2 ;; esac

if [ -n "${root_arg}" ]; then
  repo_root="${root_arg}"
fi
[ -d "${repo_root}" ] || { echo "closure-lag-check: not a directory: ${repo_root}" >&2; exit 2; }
[ -d "${repo_root}/tasks" ] || { echo "closure-lag-check: not a workspace (no tasks/ dir): ${repo_root}" >&2; exit 2; }

if ! command -v node >/dev/null 2>&1; then
  echo "closure-lag-check: node required" >&2
  exit 2
fi

trace_file="${repo_root}/.quay/closure-pass-last-run.json"

# ── --record: write the closure-pass execution trace (invariant closure_pass_leaves_trace) ─────────
if [ "${mode}" = "record" ]; then
  if [ -z "${flipped}" ]; then
    echo "closure-lag-check: --record requires --flipped <N>" >&2
    exit 2
  fi
  case "${flipped}" in ''|*[!0-9]*) echo "closure-lag-check: --flipped must be a non-negative integer: ${flipped}" >&2; exit 2 ;; esac
  now="$(date +%s)"
  iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "$(dirname "${trace_file}")"
  printf '{"ranAt":%s,"flipped":%s,"at":"%s"}\n' "${now}" "${flipped}" "${iso}" > "${trace_file}"
  echo "closure-lag-check: recorded closure-pass trace (ranAt=${now} flipped=${flipped}) → ${trace_file}"
  exit 0
fi

# ── measure: compute the closure-lag signal ────────────────────────────────────────────────────────
# The not-yet-flipped count comes from the EXISTING probe (ready-pool-check.ts) — reuse, never a
# second copy of the detection arithmetic (same single-source rule as the tick doc step 1).
pool_json="$(node --no-warnings --experimental-strip-types "${SCRIPT_DIR}/ready-pool-check.ts" --root "${repo_root}" --json 2>/dev/null || true)"
if [ -z "${pool_json}" ]; then
  echo "closure-lag-check: ready-pool-check produced no output — cannot measure closure lag" >&2
  exit 2
fi

# Count excluded[] entries whose reasons include `not-yet-flipped` via the workspace's own runtime.
not_flipped="$(printf '%s' "${pool_json}" | node -e '
  let s = "";
  process.stdin.on("data", (d) => { s += d; });
  process.stdin.on("end", () => {
    try {
      const r = JSON.parse(s);
      const ex = r.excluded || [];
      let n = 0;
      for (const e of ex) { if ((e.reasons || []).includes("not-yet-flipped")) n++; }
      process.stdout.write(String(n));
    } catch (_) { process.stdout.write("-1"); }
  });
' 2>/dev/null || echo "-1")"

if [ "${not_flipped}" = "-1" ] || ! [ "${not_flipped}" -ge 0 ] 2>/dev/null; then
  echo "closure-lag-check: could not parse ready-pool-check output" >&2
  exit 2
fi

now="$(date +%s)"
trace_present=0
ran_at=""
last_flipped=""
if [ -f "${trace_file}" ]; then
  trace_present=1
  ran_at="$(sed -n 's/.*"ranAt"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "${trace_file}" | head -1)"
  last_flipped="$(sed -n 's/.*"flipped"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "${trace_file}" | head -1)"
fi

backlog_fired=0
overdue_fired=0
if [ "${not_flipped}" -gt "${threshold}" ] 2>/dev/null; then
  backlog_fired=1
fi
if [ "${trace_present}" -eq 1 ] && [ -n "${ran_at}" ] && [ $(( now - ran_at )) -gt "${timeout}" ] 2>/dev/null; then
  overdue_fired=1
fi
if [ "${trace_present}" -eq 0 ] && [ "${not_flipped}" -gt 0 ] 2>/dev/null; then
  # Never ran, yet there is work to close — that IS a lag (the 8.5h-silent defect class).
  overdue_fired=1
fi

signal=$(( backlog_fired + overdue_fired ))

# ── --json: machine-readable measure (never mutates) ───────────────────────────────────────────────
if [ "${mode}" = "json" ]; then
  if [ "${backlog_fired}" -eq 1 ]; then bf=true; else bf=false; fi
  if [ "${overdue_fired}" -eq 1 ]; then of=true; else of=false; fi
  if [ "${signal}" -gt 0 ]; then sig=true; else sig=false; fi
  if [ -n "${ran_at}" ]; then ran_json="${ran_at}"; else ran_json=null; fi
  if [ -n "${last_flipped}" ]; then flipped_json="${last_flipped}"; else flipped_json=null; fi
  printf '{"not_yet_flipped":%s,"threshold":%s,"timeout":%s,"closure_pass_last_run":%s,"last_flipped":%s,"backlog_over_threshold":%s,"closure_pass_overdue":%s,"signal":%s}\n' \
    "${not_flipped}" "${threshold}" "${timeout}" "${ran_json}" "${flipped_json}" "${bf}" "${of}" "${sig}"
  [ "${signal}" -gt 0 ] && exit 1 || exit 0
fi

# ── measure (default): report the signal ───────────────────────────────────────────────────────────
if [ "${signal}" -gt 0 ]; then
  reasons=""
  if [ "${backlog_fired}" -eq 1 ]; then
    reasons="${reasons} not-yet-flipped=${not_flipped} > threshold=${threshold}"
  fi
  if [ "${overdue_fired}" -eq 1 ]; then
    if [ "${trace_present}" -eq 1 ]; then
      reasons="${reasons} closure-pass-overdue (last run ${ran_at}s epoch, age=$(( now - ran_at ))s > timeout=${timeout}s)"
    else
      reasons="${reasons} closure-pass-never-ran with ${not_flipped} task(s) awaiting closure"
    fi
  fi
  echo "CLOSURE-LAG-WARN:${reasons}"
  exit 1
fi

echo "closure-lag-check: ok (not-yet-flipped=${not_flipped} ≤ threshold=${threshold}; closure-pass fresh)"
exit 0
