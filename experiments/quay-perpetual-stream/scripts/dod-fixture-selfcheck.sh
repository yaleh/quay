#!/usr/bin/env bash
# dod-fixture-selfcheck.sh — regression acceptance test for the DoD meta-enforcer (DIR-019, extended
# by M32-dod-escrow-testfloor / DIR-017 Step 2 for Clauses 6-7).
#
# This is the EXTERNAL, human-authored acceptance predicate for DIR-019 (and, transitively, for
# DIR-017's human-verification gate step #2/#5). It does NOT trust the DoD enforcer's self-report:
# it runs `it0-dod-check.sh` against a fixed set of fixtures and asserts the EXPECTED exit code for
# each. "DIR-019 done" means: this script exits 0 (every fixture behaves as asserted).
#
# CRITICAL (do not rewrite the fixtures to make this pass — that is Goodhart on the test): the two
# `self-exempt-*-stub.md` fixtures are RED against the pre-DIR-019 enforcer. They currently FAIL this
# script (the enforcer wrongly exits 0 where 1 is asserted). The fix belongs in
# `it0-dod-check.mjs` clause 5, NOT in these fixtures. When the fix lands, this script must go green
# with the fixtures UNCHANGED.
#
# M32 extension (DIR-017 Step 2): 4 new fixtures added below (2 clauses × violating/compliant pair
# each) for Clause 6 (escrow-Δv) and Clause 7 (product-work test-floor) — the original 5 CASES above
# are unchanged, same discipline as DIR-019's own "fixtures unchanged" rule for a fix to the
# enforcer's own code.
#
# Usage:  dod-fixture-selfcheck.sh
# Exit:   0 = all fixtures behaved as asserted; 1 = at least one mismatch; 2 = environment error.

set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }

CHECK="./scripts/it0-dod-check.sh"
FIX="fixtures/dod"
[ -x "$CHECK" ] || { echo "ERROR: $CHECK not found/executable" >&2; exit 2; }

# id | charter+absorb fixture file | expected exit code
CASES=(
  "M98-fake-compliant|$FIX/compliant-stub.md|0"
  "M99-fake-violating|$FIX/violating-stub.md|1"
  "M96-fake-linebudget-self-exempt|$FIX/self-exempt-linebudget-stub.md|1"
  "M95-fake-implrow-self-exempt|$FIX/self-exempt-implrow-stub.md|1"
  "M94-fake-missing-ac|$FIX/missing-ac-stub.md|1"
  # M32-dod-escrow-testfloor (DIR-017 Step 2) additions — Clause 6 (escrow-Δv) and Clause 7
  # (product-work test-floor). Existing 5 cases above UNCHANGED.
  "M97-fake-escrow-violating|$FIX/escrow-deltav-violating-stub.md|1"
  "M97B-fake-escrow-compliant|$FIX/escrow-deltav-compliant-stub.md|0"
  "M93-fake-testfloor-violating|$FIX/test-floor-violating-stub.md|1"
  "M93B-fake-testfloor-compliant|$FIX/test-floor-compliant-stub.md|0"
)

fail=0
for c in "${CASES[@]}"; do
  IFS='|' read -r id file want <<< "$c"
  "$CHECK" "$id" "$file" "$file" >/dev/null 2>&1
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
  echo "PASS: all ${#CASES[@]} DoD fixtures behaved as asserted."
  exit 0
else
  echo "FAIL: at least one DoD fixture did not behave as asserted (see above)."
  echo "      If a self-exempt-* fixture wrongly exited 0, the DIR-019 clause-5 bug is still present."
  exit 1
fi
