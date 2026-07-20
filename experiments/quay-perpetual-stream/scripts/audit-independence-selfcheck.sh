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
RECORD="$FIX/dispatch-record.txt"

# id | fixture file | extra check args (space-separated, may be empty) | expected exit code
# (0 = PASS; 1 = FAIL; 2 = env error)
CASES=(
  "absent-id-m43-style|$FIX/absent-id-m43-style.md|--orchestrator-id $ORCH_ID|1"
  "self-audit-matching-id|$FIX/self-audit-matching-id.md|--orchestrator-id $ORCH_ID|1"
  # DIR-034: a bare distinct id with NO dispatch-record supplied is now FAIL by default (closes the
  # forgeable-string hole DIR-034 diagnosed) — this fixture was PASS pre-DIR-034.
  "genuinely-independent-no-record|$FIX/genuinely-independent.md|--orchestrator-id $ORCH_ID|1"
  # No orchestrator id supplied at all — fail-closed, even against the GREEN fixture.
  "no-orchestrator-id-supplied|$FIX/genuinely-independent.md||1"
  # Pre-DIR-034 escape hatch still available, explicitly opted into.
  "genuinely-independent-allow-uncorroborated|$FIX/genuinely-independent.md|--orchestrator-id $ORCH_ID --allow-uncorroborated|0"
  # DIR-034 anti-forgery: a fabricated distinct id with NO matching dispatch-record entry → FAIL.
  "fabricated-distinct-id-no-corroboration|$FIX/fabricated-distinct-id-no-corroboration.md|--orchestrator-id $ORCH_ID --dispatch-record $RECORD|1"
  # DIR-034 anti-forgery: a distinct id CORROBORATED by the dispatch-record → PASS.
  "corroborated-independent|$FIX/corroborated-independent.md|--orchestrator-id $ORCH_ID --dispatch-record $RECORD|0"
)

fail=0
for c in "${CASES[@]}"; do
  IFS='|' read -r id file extra want <<< "$c"
  # shellcheck disable=SC2086
  "$CHECK" $extra "$file" >/dev/null 2>&1
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
