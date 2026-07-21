#!/usr/bin/env bash
# outward-vt-selfcheck.sh — external acceptance for the DIR-038-C unbounded outward VT term. Proves the
# real archguard signals score non-zero + non-saturating. Rule defined SOLELY by outward-vt-check.mjs.
set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd" >&2; exit 2; }
CHK="./scripts/outward-vt-check.mjs"; FIX="fixtures/outward-vt"
[ -f "$CHK" ] || { echo "ERROR: $CHK not found" >&2; exit 2; }
fail=0
out=$(node "$CHK" "$FIX/archguard-signals.json" 2>&1); ec=$?
echo "$out" | grep -q "OUTWARD VT TERM = 44" && echo "$out" | grep -q "non-saturating: confirmed" && [ "$ec" = 0 ] \
  && echo "PASS: real archguard signals → outward 44, non-saturating" || { echo "FAIL: $out (exit $ec)"; fail=1; }
node "$CHK" "$FIX/nope.json" >/dev/null 2>&1; [ "$?" = 2 ] && echo "PASS: missing file → exit 2" || { echo "FAIL: missing-file"; fail=1; }
echo
if [ "$fail" = 0 ]; then echo "PASS: all outward-vt cases behaved as asserted."; exit 0
else echo "FAIL: a case mismatched (fix in the module — DIR-019)."; exit 1; fi
