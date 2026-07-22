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
# RED→GREEN: candidate physically IN --board with a NOVEL finding must ACCEPT (the as-wired routine flow).
printf '## Finding\nroutine-file-gate boardKeys includes candidate itself when staged in board dir; repro `node scripts/routine-file-gate.mjs --board dir/ dir/PROBE.md` exit 1 instead of 0.\n## Requested action\nfix\n' > "$T/PROBE-novel-in-board.md"
node "$CHK" --board "$T" "$T/PROBE-novel-in-board.md" >/dev/null 2>&1; [ "$?" = 0 ] && echo "PASS: novel candidate in --board → ACCEPT" || { echo "FAIL: novel-in-board self-reject"; fail=1; }
rm -f "$T/PROBE-novel-in-board.md"
# RED: history-mining finding without session-id/commit ref → REJECT
printf '## Finding\nMeta-cc session mining shows agents fail to close tasks properly. This is a systemic issue.\n## Requested action\nAdd a gate to enforce task closure.\n' > "$T/no-ref.md"
node "$CHK" "$T/no-ref.md" >/dev/null 2>&1
if [ "$?" = 1 ]; then echo "PASS: history-mining finding without ref → REJECT"; else echo "FAIL: expected REJECT for ref-less finding"; fail=1; fi
# GREEN: history-mining finding WITH session-id/commit ref → ACCEPT
printf '## Finding\nSession `abc1234ef` shows a recurring pattern: acceptance gate missing `cwd` param on MCP calls (see commit `a1b2c3d`). Evidence: `node packages/quay/test/gate.test.mjs` exit 1 in 3 consecutive sessions.\n## Requested action\nFile as defect task with gate-cwd AC.\n' > "$T/with-ref.md"
node "$CHK" "$T/with-ref.md" >/dev/null 2>&1
if [ "$?" = 0 ]; then echo "PASS: history-mining finding with session ref → ACCEPT"; else echo "FAIL: expected ACCEPT for ref-backed finding"; fail=1; fi
rm -rf "$T"
echo; if [ "$fail" = 0 ]; then echo "PASS: all routine-file-gate cases behaved as asserted."; exit 0; else echo "FAIL."; exit 1; fi
