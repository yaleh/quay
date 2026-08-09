#!/usr/bin/env bash
# plugin/scripts/process-budget.sh — the cross-layer TOTAL PROCESS BUDGET authority
# (gap-test-concurrency-cap-does-not-scope-nested-spawns, AC1).
#
# The single authority for "how many node --test (node-MainThread) processes the WHOLE repo may run
# at once, across ALL worktrees". Every layer that would otherwise derive its own concurrency reads
# THIS instead of each deriving its own:
#   - scripts/test.sh default_concurrency_formula  (C face — top-level worker count)
#   - cap-from-gate.ts effective_cap slot cap      (B face — dispatch slots)
#   - resource-gate.sh --for full-suite            (A face — worktree scheduling)
#
# The budget is nproc-derived: on a 4-core box the whole repo may run 4 node --test processes at
# once.
#
# COUNTING SCOPE (gap-process-budget-counts-infra-as-test-concurrency-cap-pinned-1, AC2/AC5):
# `in_use` counts ONLY the THROTTLE-ABLE TEST processes — node processes whose cmdline marks them
# as a `node --test` worker (or a direct test-file run). Resident infrastructure — MCP servers
# (one per claude session: `quay.js mcp` / `quay.ts mcp` / `quay-native mcp`), web serve
# (`quay serve --host --port`), and the suite-state monitor (`suite-state-trigger.ts --monitor`)
# — is a CONSTANT, not throttle-able concurrency, and MUST NOT count against the test budget.
#
# WHY (the defect this fixes, measured 2026-08-08 19:1xZ): the old `in_use = pgrep -xc
# node-MainThread` counted EVERY node main process as a test worker. On this box that was 17
# processes — 14 MCP + 2 serve + 1 monitor + 0 test workers — so on a 4-core box
# (total_budget=4) `available` hit 0 and `effective_cap` was structurally pinned at 1 even when
# the cpu-pressure band said GO. Counting infra as throttle-able test concurrency is the same
# defect family as cap-avg300: a signal that folds infrastructure load into the throttle-able
# quantity structurally under-reports dispatch headroom.
#
# OVERLOAD PROTECTION RETAINED (AC4): `in_use` still counts REAL test workers. Injecting a real
# `node --test` run adds `--test`-flagged processes; available drops and the cap falls with it —
# the budget still prevents nested spawns from multiplying beyond nproc.
#
# `available` = max(0, total_budget − in_use).
#
# Usage:
#   plugin/scripts/process-budget.sh          # report mode: print numbers, exit 0
#
# Output (stdout, one per line):
#   total_budget=N   # the nproc-derived upper limit (single authority)
#   in_use=N         # TEST (throttle-able) node --test processes currently running (all worktrees)
#   available=N      # max(0, total_budget − in_use)
#   verdict=GO|WAIT  # GO iff available ≥ 1
#
# Test seams (env overrides; for the unit test in plugin/test/resource-gate.test.mjs):
#   RESOURCE_GATE_TEST_NPROC         — override nproc (integer)
#   RESOURCE_GATE_TEST_NODE_PROCS    — override the FINAL in_use count (integer; the legacy seam —
#                                      pins in_use directly, exactly as the old pgrep-count seam did)
#   RESOURCE_GATE_TEST_PROC_CMDLINES — override the /proc cmdline LIST the classifier reads (one
#                                      cmdline per line, or semicolon-separated). Lets the unit test
#                                      pin the CLASSIFICATION deterministically.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

# ── classification ──────────────────────────────────────────────────────────────────────────────────
# is_test_cmdline <cmdline> — classify one node-MainThread cmdline as a throttle-able TEST process.
# Whitelist, not blacklist:
#   * `--test` in the cmdline — covers node --test (the top-level runner) AND its child workers,
#     whose flags carry --test-concurrency / --test-coverage-* / --test-name-pattern /
#     --test-isolation / --test-timeout. Measured 2026-08-08: a `node --test --test-concurrency=1
#     <file>` run shows the runner `node --test --test-concurrency=1 <file>` and a child worker
#     `<node-binary> --test-coverage-functions=0 --test-concurrency=1 ... <file>`.
#   * a test-file path argument (…test.mjs / …test.js / …test.ts / …_test.mjs / …_test.js) — a
#     direct run of a test file without --test.
# Everything else is infrastructure — `… mcp`, `… serve --host --port`, `… suite-state-trigger.ts
# --monitor`, `… session-liveness.sh` — and returns 1 (NOT counted against the test budget).
is_test_cmdline() {
  local cmdline="${1:-}"
  [ -n "${cmdline}" ] || return 1
  case "${cmdline}" in
    *--test*)  return 0 ;;
  esac
  case "${cmdline}" in
    *.test.mjs|*.test.js|*.test.ts|*.test.mts|*.test.cts|*_test.mjs|*_test.js) return 0 ;;
  esac
  return 1
}

# read_test_procs — count node-MainThread processes currently running that classify as TEST
# (throttle-able). EXACT `pgrep -x node-MainThread` comm match (the same AC4 spelling
# resource-gate.sh uses; `grep -x node` and `pgrep -f` both fail on Node's comm), then classify
# each pid's /proc/<pid>/cmdline. A pid whose cmdline is unreadable (already exited) is not
# counted — fail-open on a race, never wedges the budget.
read_test_procs() {
  local count=0 pid cmdline
  for pid in $(pgrep -x node-MainThread 2>/dev/null || true); do
    cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
    if is_test_cmdline "${cmdline}"; then count=$((count + 1)); fi
  done
  echo "${count}"
}

# classify_cmdlines <text> — test-seam classifier over a PROVIDED cmdline list (newline- or
# semicolon-separated) instead of reading /proc. Lets the unit test pin the classification
# (RESOURCE_GATE_TEST_PROC_CMDLINES) without needing real node --test processes.
classify_cmdlines() {
  local text="${1:-}" count=0 line
  while IFS= read -r line; do
    [ -n "${line}" ] || continue
    if is_test_cmdline "${line}"; then count=$((count + 1)); fi
  done <<< "${text//;/$'\n'}"
  echo "${count}"
}

total_budget="${RESOURCE_GATE_TEST_NPROC:-$(nproc 2>/dev/null || echo 1)}"

# in_use = the throttle-able TEST process count. Seams (highest precedence last):
#   RESOURCE_GATE_TEST_PROC_CMDLINES — classify this provided cmdline list instead of /proc;
#   RESOURCE_GATE_TEST_NODE_PROCS   — pin the final in_use number directly (legacy seam).
if [ -n "${RESOURCE_GATE_TEST_PROC_CMDLINES:-}" ]; then
  in_use="$(classify_cmdlines "${RESOURCE_GATE_TEST_PROC_CMDLINES}")"
else
  in_use="$(read_test_procs)"
fi
if [ -n "${RESOURCE_GATE_TEST_NODE_PROCS:-}" ]; then
  in_use="${RESOURCE_GATE_TEST_NODE_PROCS}"
fi

# Guard: a non-numeric seam degrades to the real read (a broken seam must never wedge the budget).
if ! [[ "${total_budget}" =~ ^[0-9]+$ ]]; then total_budget="$(nproc 2>/dev/null || echo 1)"; fi
if ! [[ "${in_use}" =~ ^[0-9]+$ ]]; then in_use="$(read_test_procs)"; fi

available=$(( total_budget - in_use ))
if [ "${available}" -lt 0 ]; then available=0; fi

printf 'total_budget=%s\n' "${total_budget}"
printf 'in_use=%s\n' "${in_use}"
printf 'available=%s\n' "${available}"
if [ "${available}" -ge 1 ]; then
  printf 'verdict=GO\n'
else
  printf 'verdict=WAIT\n'
fi
exit 0
