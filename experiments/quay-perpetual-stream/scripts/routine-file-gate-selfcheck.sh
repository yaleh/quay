#!/usr/bin/env bash
# routine-file-gate-selfcheck.sh — external acceptance for the DIR-051 mechanical finding gate.
set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd" >&2; exit 2; }
CHK="./scripts/routine-file-gate.mjs"
[ -f "$CHK" ] || { echo "ERROR: $CHK not found" >&2; exit 2; }
T="$(mktemp -d)"; fail=0
printf '## Finding\nrolling-slope-check.mjs returns NaN on []; repro `node scripts/rolling-slope-check.mjs x.json` exit 2.\n## Requested action\nfix\n' > "$T/good.md"
printf '## Finding\nthe code could be cleaner\n## Requested action\nimprove\n' > "$T/vague.md"
node "$CHK" "$T/good.md" >/dev/null 2>&1; [ "$?" = 0 ] && echo "PASS: actionable finding → ACCEPT" || { echo "FAIL: good"; fail=1; }
node "$CHK" "$T/vague.md" >/dev/null 2>&1; [ "$?" = 1 ] && echo "PASS: vague finding → REJECT (quality)" || { echo "FAIL: vague"; fail=1; }
node "$CHK" --board "$T" --recent 0 --k 3 "$T/good.md" >/dev/null 2>&1
cp "$T/good.md" "$T/existing.md"
node "$CHK" --board "$T" "$T/good.md" >/dev/null 2>&1; [ "$?" = 1 ] && echo "PASS: duplicate on board → REJECT (dedup)" || { echo "FAIL: dedup"; fail=1; }
rm -rf "$T"
echo; if [ "$fail" = 0 ]; then echo "PASS: all routine-file-gate cases behaved as asserted."; exit 0; else echo "FAIL."; exit 1; fi
