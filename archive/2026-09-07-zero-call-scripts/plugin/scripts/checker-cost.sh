#!/usr/bin/env bash
# plugin/scripts/checker-cost.sh — pure-append cost ledger for every checker/gate execution
# (tasks/gap-no-criterion-records-its-own-cost-checker-cost-jsonl).
#
# PROBLEM IT FIXES: NO criterion recorded its own cost. The ready-pool-check slope
# 35.8s -> 91.2s in one hour (n 19->24, cost 2.55x while O(n^2) predicts 1.6x) was ONLY visible
# because the manager hand-timed it twice; all 16 static checkers + 14 gates persisted ZERO
# execution time (full-suite-state.json durationMs is the single exception, and suite-level only).
# Criterion-cost DEGRADATION was completely invisible until a human hand-measured.
#
# THIS WRAPPER IS THE ENABLING MECHANISM for the whole criterion-cost family: every criterion
# (static checker / gate) that is wrapped in it appends one JSON line
#     {name, ms, n, load, exit, ts}
# to <root>/.quay/checker-cost.jsonl on exit. Pure append, ZERO judgment — no thresholds, no
# labels (that is the trend criterion's job, gap-quality-criteria-are-point-in-time-no-trend-
# criteria). The trend grows itself.
#
# WHY load (AC1 / attribution correction 2026-08-05 07:27Z): ready-pool-check's three real
# measurements were 35.8s (pool 19) -> 91.2s (pool 24) -> 157.0s (pool 24). The LAST TWO share
# the same pool yet cost grew 1.7x — the dominant variable is MACHINE LOAD (load 30.91), not pool
# size n. Recording {ms, n, load} together is the ONLY way a future reader can split "cost grew
# because n grew" from "cost grew because the machine got busy" without a human hand-measuring.
# If every criterion execution had recorded {name, ms, n, load}, the misattribution (three
# O(n^2) optimizations targeting the wrong axis) would never have happened.
#
# Usage:
#   checker-cost.sh <name> [--n <size>] [--root <dir>] -- <command...>
#     <name>     — the criterion's canonical name (safe chars [A-Za-z0-9_.-]+); becomes `name`.
#     --n <size> — the size dimension the criterion ran over (pool/tasks/files/scanned…).
#                  Default 0. This is what lets the reader distinguish a real n-growth slope
#                  from a load-driven one.
#     --root     — workspace root; the ledger is <root>/.quay/checker-cost.jsonl. Default: this
#                  script's own repo root (two dirs up), which is correct in-repo and installed.
#     --         — separator; everything after is the wrapped command.
#   Exit status: the wrapped command's exit code, propagated unchanged (recording is best-effort).
#
# Example:
#   bash plugin/scripts/checker-cost.sh ready-pool-check --n 19 -- \
#     node --experimental-strip-types plugin/scripts/ready-pool-check.ts
#
# Test seams (mirror RESOURCE_GATE_TEST_*; the AC2 fixture in plugin/test/checker-cost.test.mjs):
#   CHECKER_COST_TEST_LOAD     — override the /proc/loadavg 1min reading (float).
#   CHECKER_COST_TEST_DELAY_MS — sleep N ms before recording (int). The AC2 fixture reproduces the
#                                35.8->91.2->157.0 slope deterministically with delay + load seams.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

# ── self-locate (works in-repo AND installed: <workspace>/plugin/scripts/checker-cost.sh) ──────────
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT="$(cd "${SELF_DIR}/.." && pwd)"

# ── argument parsing (flags in any order, then `--` then the command) ────────────────────────────────
if [ "$#" -lt 2 ]; then
  echo "usage: checker-cost.sh <name> [--n <size>] [--root <dir>] -- <command...>" >&2
  exit 2
fi
NAME="${1:?checker-cost: name required}"
shift
N=0
ROOT="${DEFAULT_ROOT}"
while [ "$#" -gt 0 ]; do
  case "${1}" in
    --n)
      N="${2:?checker-cost: --n requires a value}"
      shift 2
      ;;
    --root)
      ROOT="${2:?checker-cost: --root requires a value}"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "checker-cost: expected '--' separator before the command, got '${1}'" >&2
      exit 2
      ;;
  esac
done

# Name must be JSON-safe (no quotes/backslashes/control chars) — validated rather than escaped so a
# bad name fails loud at the wrap site, never writes a corrupt ledger line.
if [[ ! "${NAME}" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "checker-cost: invalid name '${NAME}' (must match [A-Za-z0-9_.-]+)" >&2
  exit 2
fi
if ! [[ "${N}" =~ ^[0-9]+$ ]]; then
  echo "checker-cost: invalid --n '${N}' (must be a non-negative integer)" >&2
  exit 2
fi

# ── timing + run (set -e safe: capture the command's exit, never ours) ─────────────────────────────
now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    local t="${EPOCHREALTIME}" sec frac
    sec="${t%.*}"
    frac="${t#*.}"
    printf '%s%s' "${sec}" "${frac:0:3}"
  else
    date +%s%3N
  fi
}
start_ms="$(now_ms)"
if "$@"; then
  rc=0
else
  rc=$?
fi
end_ms="$(now_ms)"
ms=$(( end_ms - start_ms ))

# ── load (the attribution-correction dimension): /proc/loadavg 1min field ───────────────────────────
read_load() {
  if [ -n "${CHECKER_COST_TEST_LOAD:-}" ]; then
    printf '%s' "${CHECKER_COST_TEST_LOAD}"
    return
  fi
  awk '{print $1}' /proc/loadavg 2>/dev/null || printf '0'
}

# AC2 fixture seam: simulate a heavy run deterministically (the 35.8->91.2->157 slope) — the delay
# is added AFTER the command so ms includes it, exactly as a real slow run would.
if [ -n "${CHECKER_COST_TEST_DELAY_MS:-}" ] && [[ "${CHECKER_COST_TEST_DELAY_MS}" =~ ^[0-9]+$ ]]; then
  sleep "$(( CHECKER_COST_TEST_DELAY_MS / 1000 )).$(( CHECKER_COST_TEST_DELAY_MS % 1000 ))"
  end_ms="$(now_ms)"
  ms=$(( end_ms - start_ms ))
fi

load="$(read_load)"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── append (best-effort: a ledger write must NEVER break the checker) ───────────────────────────────
ledger="${ROOT}/.quay/checker-cost.jsonl"
if mkdir -p "$(dirname "${ledger}")" 2>/dev/null; then
  printf '{"name":"%s","ms":%s,"n":%s,"load":%s,"exit":%s,"ts":"%s"}\n' \
    "${NAME}" "${ms}" "${N}" "${load}" "${rc}" "${ts}" >> "${ledger}" \
    || echo "checker-cost: warning — could not append to ${ledger}" >&2
else
  echo "checker-cost: warning — could not create ledger dir for ${ledger}; recording skipped (fail-open)" >&2
fi

# ── propagate the wrapped command's exit code ───────────────────────────────────────────────────────
exit "${rc}"
