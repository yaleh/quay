#!/usr/bin/env bash
# serial-fanin-absorb-selfcheck.sh — external acceptance for the fan-in plan (DIR-044 increment 3).
# Asserts the observable plan (counter delta, order, entries) for fixed manifests. Rule defined SOLELY
# by serial-fanin-absorb.mjs (computeFanIn/verifyMonotonic). Fix belongs in the module (DIR-019).
#   Exit: 0 = all cases as asserted; 1 = mismatch; 2 = environment error.
set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }
SH="./scripts/serial-fanin-absorb.ts"; FIX="fixtures/fanin"
[ -f "$SH" ] || { echo "ERROR: $SH not found" >&2; exit 2; }
fail=0
# Case 1: 2-build manifest at counter 73 → counter 73 → 75, deterministic id-sorted order.
got=$(node "$SH" --counter 73 "$FIX/two-build-manifest.json" 2>/dev/null | grep '^FAN-IN')
echo "$got" | grep -q "73 → 75" \
  && echo "$got" | grep -q "M-dir039-migration → M-dir042a-dod-gate-set" \
  && echo "PASS: 2-build fan-in → counter +2, deterministic order" || { echo "FAIL: got: $got"; fail=1; }
# Case 2: bad --counter usage → exit 2.
node "$SH" "$FIX/two-build-manifest.json" >/dev/null 2>&1; [ "$?" = 2 ] \
  && echo "PASS: missing --counter → exit 2" || { echo "FAIL: missing --counter did not exit 2"; fail=1; }
echo
if [ "$fail" = 0 ]; then echo "PASS: all serial-fanin-absorb cases behaved as asserted."; exit 0
else echo "FAIL: at least one case mismatched (fix belongs in the module — DIR-019)."; exit 1; fi
