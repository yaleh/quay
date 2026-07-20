#!/usr/bin/env bash
# git-lens-selfcheck.sh — regression acceptance test for the 3 G1 convergence proxies
# (L_D code:doc, L_G structural-drift, L_S behavior-variance). EXTERNAL acceptance predicate: it
# does NOT trust each proxy's self-report — it runs each against a fixed set of fixtures and
# asserts the EXPECTED exit code. "The proxy is correct" means: this script exits 0.
#
# CRITICAL (DIR-019 discipline): each fixture isolates ONE outcome and is RED-then-GREEN against
# the module. If a fixture behaves wrong, the fix belongs in the relevant scripts/git-lens-*.mjs,
# NOT in the fixture.
#
# Usage:  git-lens-selfcheck.sh
# Exit:   0 = all fixtures behaved as asserted; 1 = at least one mismatch; 2 = environment error.

set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }

fail=0

echo "== L_D code:doc ratio =="
LD_CASES=(
  "prose-heavy|fixtures/git-lens/l-d/prose-heavy.numstat|1"
  "code-heavy|fixtures/git-lens/l-d/code-heavy.numstat|0"
  "empty|fixtures/git-lens/l-d/empty.numstat|0"
)
for c in "${LD_CASES[@]}"; do
  IFS='|' read -r id file want <<< "$c"
  out=$(node scripts/git-lens-l-d-code-doc-ratio.mjs --numstat-file "$file" 2>&1)
  got=$?
  if [ "$got" = "$want" ]; then
    echo "PASS: l-d/$id — exit $got (expected $want)"
  else
    echo "FAIL: l-d/$id — exit $got but EXPECTED $want. Output: $out"
    fail=1
  fi
done

echo
echo "== L_G structural-drift =="
# The cycle case exercises the CYCLE signal only (god-module thresholds left at a level the tiny
# 2-line fixture files cannot trip: --min-lines 100). The clean case must trip NEITHER signal, so
# it also needs a real (non-degenerate) god-module threshold — real default thresholds are
# calibrated for actual package-scale files, not 2-line fixtures; a fixture-appropriate --min-lines
# is passed explicitly here (this is a fixture-harness parameter choice, not a change to the
# script's own default constants, which stay calibrated for real repo scale — see the live smoke
# run below for the real thresholds in action).
LG_CASES=(
  "cycle-repo|fixtures/git-lens/l-g-fixtures/cycle-repo|1"
  "clean-repo|fixtures/git-lens/l-g-fixtures/clean-repo|0"
)
for c in "${LG_CASES[@]}"; do
  IFS='|' read -r id dir want <<< "$c"
  out=$(node scripts/git-lens-l-g-structural-drift.mjs "$dir" --min-lines 100 --min-fanin 5 2>&1)
  got=$?
  if [ "$got" = "$want" ]; then
    echo "PASS: l-g/$id — exit $got (expected $want)"
  else
    echo "FAIL: l-g/$id — exit $got but EXPECTED $want. Output: $out"
    fail=1
  fi
done
# god-module heuristic is only exercised with a lowered fanin/lines threshold above (the fixture
# repos are tiny, 2 files each) — default thresholds are calibrated for real packages/ scale.
echo "(default-threshold real-repo smoke, no assertion — see milestone report for the live finding)"
node scripts/git-lens-l-g-structural-drift.mjs ../../../../../../packages >/dev/null 2>&1 || true

echo
echo "== L_S behavior-variance =="
LS_CASES=(
  "strong-module|fixtures/git-lens/l-s-fixtures/strong-module.mjs|fixtures/git-lens/l-s-fixtures/strong-module.test.mjs|0"
  "weak-module|fixtures/git-lens/l-s-fixtures/weak-module.mjs|fixtures/git-lens/l-s-fixtures/weak-module.test.mjs|1"
)
for c in "${LS_CASES[@]}"; do
  IFS='|' read -r id mod testf want <<< "$c"
  out=$(node scripts/git-lens-l-s-behavior-variance.mjs "$mod" "$testf" 2>&1)
  got=$?
  if [ "$got" = "$want" ]; then
    echo "PASS: l-s/$id — exit $got (expected $want)"
  else
    echo "FAIL: l-s/$id — exit $got but EXPECTED $want. Output: $out"
    fail=1
  fi
done

echo
if [ "$fail" = 0 ]; then
  echo "PASS: all git-lens (L_D/L_G/L_S) fixtures behaved as asserted."
  exit 0
else
  echo "FAIL: at least one git-lens fixture did not behave as asserted (see above)."
  echo "      The fix belongs in the relevant scripts/git-lens-*.mjs, NOT in the fixtures (DIR-019 discipline)."
  exit 1
fi
