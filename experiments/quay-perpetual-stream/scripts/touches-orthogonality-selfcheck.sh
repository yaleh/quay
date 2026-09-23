#!/usr/bin/env bash
# touches-orthogonality-selfcheck.sh — regression acceptance test for the milestone-`touches`
# disjointness check (DIR-044 increment 1). EXTERNAL acceptance predicate: it does NOT trust the
# check's self-report — it runs `touches-orthogonality-check.ts` (the module itself; the thin
# `.sh` wrapper it used to go through was deleted in SPEC Phase 1c) against fixed fixture charter
# PAIRS and asserts the EXPECTED exit code for each.
#
# CRITICAL (DIR-019 discipline): each pair isolates ONE outcome and is RED-then-GREEN against the
# module. If a pair behaves wrong, the fix belongs in `scripts/touches-orthogonality-check.mjs`,
# NOT in the fixture.
#
# The rule is defined SOLELY by touches-orthogonality-check.mjs (checkTouchesPair); this selfcheck
# only asserts the exit code per pair — see the module header for the semantics (do not restate here).
#
# Usage:  touches-orthogonality-selfcheck.sh
# Exit:   0 = all pairs behaved as asserted; 1 = at least one mismatch; 2 = environment error.

set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }

CHECK="./scripts/touches-orthogonality-check.ts"
FIX="fixtures/touches"
[ -f "$CHECK" ] || { echo "ERROR: $CHECK not found" >&2; exit 2; }

# id | charterA | charterB | expected exit (0 = DISJOINT; 1 = OVERLAP/conservative-serialize)
CASES=(
  "disjoint-pair|$FIX/disjoint-a.md|$FIX/disjoint-b.md|0"
  "overlap-exact-vs-glob|$FIX/overlap-a.md|$FIX/overlap-b.md|1"
  "absent-touches-serializes|$FIX/disjoint-a.md|$FIX/no-touches.md|1"
  "overbroad-glob-serializes|$FIX/overbroad.md|$FIX/disjoint-b.md|1"
  "typo-empty-expansion-serializes|$FIX/typo.md|$FIX/disjoint-b.md|1"
  # symmetry: the check must not depend on argument order
  "disjoint-pair-reversed|$FIX/disjoint-b.md|$FIX/disjoint-a.md|0"
)

fail=0
for c in "${CASES[@]}"; do
  IFS='|' read -r id a b want <<< "$c"
  node "$CHECK" "$a" "$b" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$want" ]; then
    echo "PASS: $id — exit $got (expected $want)"
  else
    echo "FAIL: $id — exit $got but EXPECTED $want [$a ∥ $b]"
    fail=1
  fi
done

echo
if [ "$fail" = 0 ]; then
  echo "PASS: all ${#CASES[@]} touches-orthogonality pairs behaved as asserted."
  exit 0
else
  echo "FAIL: at least one pair did not behave as asserted (see above)."
  echo "      The fix belongs in scripts/touches-orthogonality-check.mjs, NOT in the fixtures (DIR-019)."
  exit 1
fi
