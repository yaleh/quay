# M124 iteration-0 — clause8 multi-label first-match-wins fix

**Task:** `exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH`
**Charter:** `experiments/quay-perpetual-stream/charters/M124-clause8-multi-label-fix.md`
**Class:** development, single-pass (small, well-bounded mechanical fix).

## What was done

`experiments/quay-perpetual-stream/scripts/it0-dod-check.ts`'s clause8 label scan changed from a
single `.match()` (first occurrence only) to `matchAll` + `Math.max(...)` over all matches:

```diff
- const milestoneLabelMatch = taskText.match(/milestone:M-?(\d+)/i);
- const taskMilestoneNum = milestoneLabelMatch ? parseInt(milestoneLabelMatch[1], 10) : null;
+ const milestoneLabelMatches = [...taskText.matchAll(/milestone:M-?(\d+)/gi)];
+ const taskMilestoneNum = milestoneLabelMatches.length > 0
+   ? Math.max(...milestoneLabelMatches.map((m) => parseInt(m[1], 10)))
+   : null;
```

## Real evidence

```
$ node -e "... taskText.matchAll(/milestone:M-?(\d+)/gi) ..." tasks/exp5-M-GATE-CLI-ERROR-UX.md
labels found: [ '37', '56' ] -> max: 56 -> clause8 applies: true

$ ... tasks/exp5-M-GATE-HELP-SYNOPSIS-GAP.md
labels found: [ '37', '51' ] -> max: 51 -> clause8 applies: true

$ ... tasks/exp5-M-GATE-MCP-PARITY-GAP.md
labels found: [ '37', '53' ] -> max: 53 -> clause8 applies: true
```
All 3 previously-N/A-misreported real tasks now genuinely have clause8 applying.

```
$ bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh
PASS: all 17 DoD fixtures behaved as asserted.
```
Golden-diff unchanged — 0 regression on the existing 17 fixtures.

Added 3 new fixture tests to `test/it0-dod-check.test.mjs` (low-then-high order, high-then-low order,
all-below-cutover):
```
$ node --test experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs
tests 43, pass 43, fail 0   (was 40/40 before + 3 new)

$ node --test $(find experiments -name "*.test.mjs")
tests 475, pass 475, fail 0   (was 472/472 before + 3 new)
```
No other clause's verdict changed as a side effect.

## Not in scope / deferred

- Clause8's cutover logic itself (`N >= 40` threshold, what it checks once applying) — unchanged.
