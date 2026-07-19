#!/usr/bin/env bash
# loadbearing-test-gate-selfcheck.sh — regression acceptance test for the load-bearing test-gate
# (exp5-M-CRYST-B7-LOADBEARING-TEST-GATE, the mechanical enforcement of ADR-001 Decision clause 2).
# EXTERNAL acceptance predicate: it does NOT trust the gate's self-report — it runs
# `loadbearing-test-gate.sh` against a fixed fixture TREE and asserts the EXPECTED exit code for each
# scenario. "The gate is correct" means: this script exits 0.
#
# CRITICAL (DIR-019 discipline): each fixture isolates ONE load-bearing criterion / disposition and is
# RED-then-GREEN against the module. If a fixture behaves wrong, the fix belongs in
# `scripts/loadbearing-test-gate.mjs`, NOT in the fixtures.
#
# The rule (ADR-001 Decision clause 2): a `scripts/*.mjs` is LOAD-BEARING iff at least one of
#   (a) imported by another module (grep 'from ".*<name>.mjs"');
#   (b) wrapped/registered by the gate registry;
#   (c) named by OUTER-LOOP.md as a milestone_counter++ gate.
# A load-bearing script MUST have a sibling `<name>.test.mjs` under a test/ dir → else FAIL (exit 1).
# A non-load-bearing script is N/A (never a silent skip, never a FAIL).
#
# Usage:  loadbearing-test-gate-selfcheck.sh
# Exit:   0 = all scenarios behaved as asserted; 1 = at least one mismatch; 2 = environment error.

set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }

GATE="./scripts/loadbearing-test-gate.sh"
FIX="fixtures/loadbearing"
[ -x "$GATE" ] || { echo "ERROR: $GATE not found/executable" >&2; exit 2; }

fail=0
run() {  # id | expected-exit | args...
  local id="$1"; local want="$2"; shift 2
  "$GATE" "$@" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then
    echo "PASS: $id — exit $got (expected $want)"
  else
    echo "FAIL: $id — exit $got but EXPECTED $want"
    fail=1
  fi
}

# Scenario 1 — the full fixture tree has TWO load-bearing scripts (registered + counter-gate) that
# lack a sibling test → gate FAILs (exit 1).
run "full-tree-has-untested-loadbearing" 1 \
  --scripts "$FIX/scripts" --tests "$FIX/test" \
  --import-root "$FIX/scripts" \
  --registry "$FIX/fake-registry.js" --outer-loop "$FIX/fake-outer-loop.md"

# Scenario 2 — point the gate at NO registry / NO outer-loop so only criterion (a) fires: the single
# load-bearing script (fixture-imported.mjs) HAS its sibling test → gate PASSes (exit 0). This isolates
# the PASS path (a covered load-bearing script) from the FAIL path above.
run "criterion-a-only-covered-loadbearing-passes" 0 \
  --scripts "$FIX/scripts" --tests "$FIX/test" \
  --import-root "$FIX/scripts" \
  --registry "$FIX/does-not-exist.js" --outer-loop "$FIX/does-not-exist.md"

# Scenario 3 — usage error (no --scripts) → exit 2.
run "usage-error-no-scripts" 2

echo
if [ "$fail" = 0 ]; then
  echo "PASS: all loadbearing-test-gate scenarios behaved as asserted."
  exit 0
else
  echo "FAIL: at least one loadbearing-test-gate scenario did not behave as asserted (see above)."
  echo "      The fix belongs in scripts/loadbearing-test-gate.mjs, NOT in the fixtures (DIR-019 discipline)."
  exit 1
fi
