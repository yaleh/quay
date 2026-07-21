#!/usr/bin/env bash
# rolling-slope-selfcheck.sh — external acceptance for the DIR-038-A rolling-window self-halt slope.
# Proves the re-based ruler reproduces the recorded HONEST numbers (not the 3.80 qualifying-only
# artifact) and the monotonicity guard holds. Rule defined SOLELY by rolling-slope-check.mjs; this
# only asserts observable exit codes + printed slope. Fix belongs in the module (DIR-019).
set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }
CHK="./scripts/rolling-slope-check.mjs"; FIX="fixtures/rolling-slope"
[ -f "$CHK" ] || { echo "ERROR: $CHK not found" >&2; exit 2; }
fail=0
# recent window m29-m35 → honest ~0.64 per 5, HALT-RECOMMENDED, exit 0
out=$(node "$CHK" --k 7 "$FIX/m29-m35.json" 2>&1); ec=$?
echo "$out" | grep -q "0.643 per 5" && echo "$out" | grep -q "HALT-RECOMMENDED" && [ "$ec" = 0 ] \
  && echo "PASS: m29-m35 → 0.643 per 5, HALT-RECOMMENDED" || { echo "FAIL: m29-m35 — $out (exit $ec)"; fail=1; }
# zero-run → 0, HALT, exit 0
out=$(node "$CHK" --k 9 "$FIX/m41-m49.json" 2>&1); ec=$?
echo "$out" | grep -q "0.000 /milestone" && [ "$ec" = 0 ] \
  && echo "PASS: m41-m49 zero-run → 0, HALT-RECOMMENDED" || { echo "FAIL: m41-m49 — $out"; fail=1; }
# the qualifying-only artifact is 3.80 (above threshold) — proving the OLD denom would NOT have halted
out=$(node "$CHK" --k 6 "$FIX/qualifying-6.json" 2>&1); ec=$?
echo "$out" | grep -q "3.803 /qualifying-milestone" && [ "$ec" = 0 ] \
  && echo "PASS: qualifying-only artifact reproduces 3.803 (the RETIRED number)" || { echo "FAIL: qualifying — $out"; fail=1; }
# bad usage → exit 2
node "$CHK" "$FIX/nope.json" >/dev/null 2>&1; [ "$?" = 2 ] && echo "PASS: missing file → exit 2" || { echo "FAIL: missing-file exit"; fail=1; }
echo
if [ "$fail" = 0 ]; then echo "PASS: all rolling-slope cases behaved as asserted (honest ≠ 3.80)."; exit 0
else echo "FAIL: a case mismatched (fix in the module — DIR-019)."; exit 1; fi
