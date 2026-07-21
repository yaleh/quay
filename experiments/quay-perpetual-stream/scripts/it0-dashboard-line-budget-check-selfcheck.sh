#!/usr/bin/env bash
# it0-dashboard-line-budget-check-selfcheck.sh — regression acceptance test for the dashboard
# line-budget gate (DIR-054 / M78).
#
# EXTERNAL acceptance predicate — does NOT trust the gate's self-report. Runs
# it0-dashboard-line-budget-check.sh against two synthetic fixtures:
#   - over-cap fixture (>1200 lines) → MUST exit non-zero (RED)
#   - under-cap fixture (<1200 lines) → MUST exit 0 (GREEN)
#
# DIR-019 discipline: if a fixture behaves wrong, the fix belongs in
# it0-dashboard-line-budget-check.sh, NOT in the fixtures.
#
# Usage:  it0-dashboard-line-budget-check-selfcheck.sh
# Exit:   0 = both assertions hold; 1 = at least one mismatch; 2 = environment error.

set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }

CHECK="./scripts/it0-dashboard-line-budget-check.sh"
[ -x "$CHECK" ] || { echo "ERROR: $CHECK not found/executable" >&2; exit 2; }

TMPDIR_SELF="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SELF"' EXIT

OVER_CAP_FIXTURE="$TMPDIR_SELF/over-cap-fixture.md"
UNDER_CAP_FIXTURE="$TMPDIR_SELF/under-cap-fixture.md"

# --- Generate over-cap fixture (1201 lines) ---
{
  echo "# Dashboard fixture — over-cap (1201 lines)"
  for i in $(seq 1 1200); do
    echo "line $i — filler content to exceed the 1200-line cap"
  done
} > "$OVER_CAP_FIXTURE"

# --- Generate under-cap fixture (100 lines) ---
{
  echo "# Dashboard fixture — under-cap (100 lines)"
  for i in $(seq 1 99); do
    echo "line $i — filler content well within the 1200-line cap"
  done
} > "$UNDER_CAP_FIXTURE"

fail=0

# RED check: over-cap fixture must exit non-zero
"$CHECK" "$OVER_CAP_FIXTURE" > /dev/null 2>&1
over_exit=$?
if [ "$over_exit" -ne 0 ]; then
  echo "PASS (RED): over-cap fixture correctly exited non-zero (exit $over_exit)"
else
  echo "FAIL (RED): over-cap fixture wrongly exited 0 — gate should have FAILED on $( wc -l < "$OVER_CAP_FIXTURE" ) lines"
  fail=1
fi

# GREEN check: under-cap fixture must exit 0
"$CHECK" "$UNDER_CAP_FIXTURE" > /dev/null 2>&1
under_exit=$?
if [ "$under_exit" -eq 0 ]; then
  echo "PASS (GREEN): under-cap fixture correctly exited 0"
else
  echo "FAIL (GREEN): under-cap fixture wrongly exited non-zero (exit $under_exit) — gate should have PASSED on $( wc -l < "$UNDER_CAP_FIXTURE" ) lines"
  fail=1
fi

echo
if [ "$fail" = 0 ]; then
  echo "PASS: both dashboard line-budget fixtures behaved as asserted (RED+GREEN)."
  exit 0
else
  echo "FAIL: at least one fixture did not behave as asserted (see above)."
  echo "      The fix belongs in scripts/it0-dashboard-line-budget-check.sh, NOT in the fixtures (DIR-019 discipline)."
  exit 1
fi
