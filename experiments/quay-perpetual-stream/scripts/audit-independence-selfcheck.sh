#!/usr/bin/env bash
# audit-independence-selfcheck.sh — regression acceptance test for the DIR-032 audit-independence
# check. EXTERNAL acceptance predicate: it does NOT trust the check's self-report — it runs
# `audit-independence-check.sh` against a fixed set of fixtures and asserts the EXPECTED exit code
# for each. "The independence check is correct" means: this script exits 0.
#
# CRITICAL (DIR-019 discipline): each fixture isolates ONE independence outcome and is
# RED-then-GREEN against the module. If a fixture behaves wrong, the fix belongs in
# `scripts/audit-independence-check.mjs`, NOT in the fixture.
#
# The rule is defined SOLELY by audit-independence-check.mjs (evaluateIndependence); this selfcheck
# only asserts the exit code per fixture — see the module's header for the rule (do not restate it
# here).
#
# Usage:  audit-independence-selfcheck.sh
# Exit:   0 = all fixtures behaved as asserted; 1 = at least one mismatch; 2 = environment error.

set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }

CHECK="./scripts/audit-independence-check.sh"
FIX="fixtures/audit-independence"
[ -x "$CHECK" ] || { echo "ERROR: $CHECK not found/executable" >&2; exit 2; }

ORCH_ID="orchestrator-session-abc123"

# id | fixture file | orchestrator-id arg (or "" for none) | expected exit code (0 = PASS; 1 = FAIL)
CASES=(
  "absent-id-m43-style|$FIX/absent-id-m43-style.md|$ORCH_ID|1"
  "self-audit-matching-id|$FIX/self-audit-matching-id.md|$ORCH_ID|1"
  "genuinely-independent|$FIX/genuinely-independent.md|$ORCH_ID|0"
  # No orchestrator id supplied at all — fail-closed, even against the GREEN fixture.
  "no-orchestrator-id-supplied|$FIX/genuinely-independent.md||1"
)

fail=0
for c in "${CASES[@]}"; do
  IFS='|' read -r id file orch want <<< "$c"
  if [ -n "$orch" ]; then
    "$CHECK" --orchestrator-id "$orch" "$file" >/dev/null 2>&1
  else
    "$CHECK" "$file" >/dev/null 2>&1
  fi
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
  echo "PASS: all ${#CASES[@]} audit-independence fixtures behaved as asserted."
  exit 0
else
  echo "FAIL: at least one audit-independence fixture did not behave as asserted (see above)."
  echo "      The fix belongs in scripts/audit-independence-check.mjs, NOT in the fixtures (DIR-019 discipline)."
  exit 1
fi
