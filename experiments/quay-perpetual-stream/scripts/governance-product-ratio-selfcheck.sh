#!/usr/bin/env bash
# governance-product-ratio-selfcheck.sh — external acceptance for the DIR-038-B governance:product
# degradation signal. Proves the recorded runaway (≈8:1) BREACHES and a healthy window does not; the
# rule is defined SOLELY by governance-product-ratio-check.mjs. Fix belongs in the module (DIR-019).
set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd" >&2; exit 2; }
CHK="./scripts/governance-product-ratio-check.ts"; FIX="fixtures/gov-product"
[ -f "$CHK" ] || { echo "ERROR: $CHK not found" >&2; exit 2; }
fail=0
out=$(node "$CHK" "$FIX/recorded-window.json" 2>&1); ec=$?
echo "$out" | grep -q "8.27:1" && echo "$out" | grep -q "BREACH" && [ "$ec" = 1 ] \
  && echo "PASS: recorded window 8.27:1 → BREACH (exit 1)" || { echo "FAIL: recorded — $out (exit $ec)"; fail=1; }
out=$(node "$CHK" "$FIX/healthy-window.json" 2>&1); ec=$?
echo "$out" | grep -q "within threshold" && [ "$ec" = 0 ] \
  && echo "PASS: healthy window → no breach (exit 0)" || { echo "FAIL: healthy — $out"; fail=1; }
node "$CHK" "$FIX/nope.json" >/dev/null 2>&1; [ "$?" = 2 ] && echo "PASS: missing file → exit 2" || { echo "FAIL: missing-file"; fail=1; }
echo
if [ "$fail" = 0 ]; then echo "PASS: all governance:product cases behaved as asserted."; exit 0
else echo "FAIL: a case mismatched (fix in the module — DIR-019)."; exit 1; fi
