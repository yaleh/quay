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
# once. `in_use` counts node-MainThread processes currently running (EXACT `pgrep -xc
# node-MainThread` comm match — the same AC4 spelling resource-gate.sh uses; `grep -x node` and
# `pgrep -f` both fail on Node's comm). `available` = max(0, total_budget − in_use).
#
# NESTED DERIVATION IS THE POINT (AC4): a worker that would otherwise spawn its own `node --test`
# (quay-init family / session family) subtracts the already-running count from the budget, so
# nested spawns can no longer multiply beyond the cap — the total across ALL layers ≤ total_budget.
#
# Usage:
#   plugin/scripts/process-budget.sh          # report mode: print numbers, exit 0
#
# Output (stdout, one per line):
#   total_budget=N   # the nproc-derived upper limit (single authority)
#   in_use=N         # node-MainThread processes currently running (all worktrees)
#   available=N      # max(0, total_budget − in_use)
#   verdict=GO|WAIT  # GO iff available ≥ 1
#
# Test seams (env overrides; for the unit test in plugin/test/resource-gate.test.mjs):
#   RESOURCE_GATE_TEST_NPROC      — override nproc (integer)
#   RESOURCE_GATE_TEST_NODE_PROCS — override the pgrep count (integer)

set -euo pipefail

total_budget="${RESOURCE_GATE_TEST_NPROC:-$(nproc 2>/dev/null || echo 1)}"
in_use="${RESOURCE_GATE_TEST_NODE_PROCS:-$(pgrep -xc node-MainThread 2>/dev/null || echo 0)}"

# Guard: a non-numeric seam degrades to the real read (a broken seam must never wedge the budget).
if ! [[ "${total_budget}" =~ ^[0-9]+$ ]]; then total_budget="$(nproc 2>/dev/null || echo 1)"; fi
if ! [[ "${in_use}" =~ ^[0-9]+$ ]]; then in_use="$(pgrep -xc node-MainThread 2>/dev/null || echo 0)"; fi

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
