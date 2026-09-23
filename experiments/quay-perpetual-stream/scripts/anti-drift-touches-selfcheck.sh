#!/usr/bin/env bash
# anti-drift-touches-selfcheck.sh — external acceptance for the anti-drift HARD guardrail (DIR-044
# increment 4). Proves the guardrail BITES: a mis-declared (overlapping) or stray-write batch HARD
# FAILS, a clean batch passes. Rule defined SOLELY by anti-drift-touches-check.mjs. Fix in the module
# (DIR-019).
#   Exit: 0 = all cases as asserted; 1 = mismatch; 2 = environment error.
set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }
CHK="./scripts/anti-drift-touches-check.ts"; FIX="fixtures/antidrift"
[ -f "$CHK" ] || { echo "ERROR: $CHK not found" >&2; exit 2; }
# id | manifest | expected exit (0 = clean; 1 = HARD FAIL)
CASES=(
  "clean-batch|$FIX/green.json|0"
  "mis-declared-overlap-BITES|$FIX/red-overlap.json|1"
  "stray-write-BITES|$FIX/red-stray.json|1"
  "overbroad-declaration-BITES|$FIX/red-overbroad.json|1"
)
fail=0
for c in "${CASES[@]}"; do
  IFS='|' read -r id file want <<< "$c"
  node "$CHK" "$file" >/dev/null 2>&1; got=$?
  [ "$got" = "$want" ] && echo "PASS: $id — exit $got (expected $want)" || { echo "FAIL: $id — exit $got EXPECTED $want"; fail=1; }
done
echo
if [ "$fail" = 0 ]; then echo "PASS: all anti-drift cases behaved as asserted (guardrail bites)."; exit 0
else echo "FAIL: guardrail did not behave as asserted (fix in the module — DIR-019)."; exit 1; fi
