#!/usr/bin/env bash
# routine-scheduler-selfcheck.sh — external acceptance for the DIR-051 routine trigger logic.
set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd" >&2; exit 2; }
CHK="./scripts/routine-scheduler.mjs"
[ -f "$CHK" ] || { echo "ERROR: $CHK not found" >&2; exit 2; }
TMP="$(mktemp)"; echo '[{"name":"self-validation","trigger":"every(5)","dispatch":"adversarial-explore"},{"name":"arch","trigger":"on(checkpoint)","dispatch":"proxy"}]' > "$TMP"
fail=0
node "$CHK" --iteration 10 "$TMP" 2>&1 | grep -q "DUE: self-validation" && [ "$(node "$CHK" --iteration 10 "$TMP" >/dev/null 2>&1; echo $?)" = 0 ] \
  && echo "PASS: every(5) due at iteration 10" || { echo "FAIL: every(5)"; fail=1; }
node "$CHK" --iteration 7 "$TMP" >/dev/null 2>&1; [ "$?" = 3 ] && echo "PASS: none due at iteration 7 → exit 3" || { echo "FAIL: none-due exit"; fail=1; }
node "$CHK" --event checkpoint "$TMP" 2>&1 | grep -q "DUE: arch" && echo "PASS: on(checkpoint) due on event" || { echo "FAIL: on(checkpoint)"; fail=1; }
rm -f "$TMP"
echo
if [ "$fail" = 0 ]; then echo "PASS: all routine-scheduler cases behaved as asserted."; exit 0
else echo "FAIL: a case mismatched (fix in the module — DIR-019)."; exit 1; fi
