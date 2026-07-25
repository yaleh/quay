#!/usr/bin/env bash
# vmeta-lag-selfcheck.sh — regression acceptance test for the V_meta consolidation-lag check
# (exp5-M-CRYST-D3 increment R5, Axis-2'). EXTERNAL acceptance predicate: it does NOT trust the
# check's self-report — runs `vmeta-lag-check.sh` against fixed fixtures and asserts expected
# exit codes. The rule is defined SOLELY by vmeta-lag-check.ts; this only asserts exit codes.
# DIR-019 discipline: fix belongs in the module, NOT in the fixtures.
# Exit: 0 = all fixtures behaved as asserted; 1 = >=1 mismatch; 2 = environment error.

source "$(dirname "$0")/gate-script-lib.sh"

CHECK="./scripts/vmeta-lag-check.sh"

# id | fixture file | expected exit code (0 = PASS/N-A; 1 = ALARM/FAIL)
CASES=(
  "over-threshold-unconsolidated-no-carryforward|fixtures/vmeta/over-threshold-unconsolidated-no-carryforward.md|1"
  "consolidated|fixtures/vmeta/consolidated.md|0"
  "within-threshold|fixtures/vmeta/within-threshold.md|0"
  "dated-carry-forward|fixtures/vmeta/dated-carry-forward.md|0"
  "ambiguous-overdue-prose|fixtures/vmeta/ambiguous-overdue-prose.md|1"
  "keywordless-status|fixtures/vmeta/keywordless-status.md|1"
  "not-yet-fully-consolidated|fixtures/vmeta/not-yet-fully-consolidated.md|1"
  "bare-prose-no-tag|fixtures/vmeta/bare-prose-no-tag.md|1"
)

gate_run_selfcheck "$CHECK"
