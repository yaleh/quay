#!/usr/bin/env bash
# vmeta-lag-selfcheck.sh — regression acceptance test for the V_meta consolidation-lag check
# (exp5-M-CRYST-D3 increment R5, Axis-2′). EXTERNAL acceptance predicate: it does NOT trust the
# check's self-report — it runs `vmeta-lag-check.sh` against a fixed set of fixtures and asserts the
# EXPECTED exit code for each. "The lag check is correct" means: this script exits 0.
#
# CRITICAL (DIR-019 discipline): each fixture isolates ONE arithmetic outcome and is RED-then-GREEN
# against the module. If a fixture behaves wrong, the fix belongs in `scripts/vmeta-lag-check.mjs`,
# NOT in the fixture.
#
# The rule (DIR-005 / OUTER-LOOP.md ABSORB): milestones-since-confirmed = milestone_counter −
# confirming-milestone; ALARM (exit 1) when > K=2 for any row that is `confirmed` but not
# `consolidated` AND has no DATED carry-forward reason.
#
# Usage:  vmeta-lag-selfcheck.sh
# Exit:   0 = all fixtures behaved as asserted; 1 = at least one mismatch; 2 = environment error.

set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }

CHECK="./scripts/vmeta-lag-check.sh"
FIX="fixtures/vmeta"
[ -x "$CHECK" ] || { echo "ERROR: $CHECK not found/executable" >&2; exit 2; }

# id | fixture file | expected exit code (0 = PASS/N-A; 1 = ALARM/FAIL)
CASES=(
  "over-threshold-unconsolidated-no-carryforward|$FIX/over-threshold-unconsolidated-no-carryforward.md|1"
  "consolidated|$FIX/consolidated.md|0"
  "within-threshold|$FIX/within-threshold.md|0"
  "dated-carry-forward|$FIX/dated-carry-forward.md|0"
)

fail=0
for c in "${CASES[@]}"; do
  IFS='|' read -r id file want <<< "$c"
  "$CHECK" "$file" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$want" ]; then
    echo "PASS: $id — exit $got (expected $want) [$file]"
  else
    echo "FAIL: $id — exit $got but EXPECTED $want [$file]"
    fail=1
  fi
done

echo
if [ "$fail" = 0 ]; then
  echo "PASS: all ${#CASES[@]} vmeta-lag fixtures behaved as asserted."
  exit 0
else
  echo "FAIL: at least one vmeta-lag fixture did not behave as asserted (see above)."
  echo "      The fix belongs in scripts/vmeta-lag-check.mjs, NOT in the fixtures (DIR-019 discipline)."
  exit 1
fi
