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
all-below-cutover).

## Correction — this milestone's own adversarial audit REFUTED the initial delivery, fixed same-pass

The dispatched audit found two real defects in iteration-0's original delivery (see
`milestones/M124/audits/iteration-0-adversarial-audit.md`), both fixed same-ABSORB:

1. **REFUTED — the 3 new fixture tests were tautological.** They asserted only
   `hasPass(r, "clause8-task-canonical-lifecycle-record")`, a substring shared by BOTH the
   "applies and passed" pass message AND the "N/A, grandfathered" pass message — the tests still
   passed when the audit reverted the production fix back to the original single-`.match()` buggy
   code. Fixed: the two "applies" tests now assert the SPECIFIC applies-path message text
   (`"task carries a real '## Proposal'"`) AND the absence of the N/A message — genuinely
   distinguishing the two outcomes. Independently re-verified myself (mirroring the audit's own
   method): ran the 2 "applies" tests against the TRUE pre-M124 original code (`git show
   f2c08a7:.../it0-dod-check.ts`) — the low-then-high test now correctly FAILS (catches the real
   original defect); the high-then-low test still passes (correctly, since a high-first label
   resolves correctly even under the old first-match code — that ordering was never broken).
2. **CONCERNS, addressed — the fix scanned the WHOLE task text, not just the frontmatter `labels:`
   block**, so an unrelated `milestone:M<N>`-shaped string incidentally quoted in a task's own body
   PROSE could spuriously inflate the max and misfire the cutover (demonstrated by the audit against
   this very defect task's own body, which harmlessly happens to quote several milestone numbers).
   Fixed: the scan is now scoped to the frontmatter block when real `---`-delimited frontmatter is
   present (the fixture-fallback path, with no real frontmatter, is unchanged). Added a new test
   creating a REAL temp task file (frontmatter label M5, body prose incidentally mentioning M99) that
   FAILS against the M124-committed-but-pre-audit-fix code and PASSES against the final fixed code —
   verified both directions myself.

Both corrections logged as `DEV-14` in `inherited-core.md`. Re-ran the full suite after both fixes:
`node --test experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs` → 44/44 pass;
`node --test $(find experiments -name "*.test.mjs")` → 476/476 pass; `dod-fixture-selfcheck.sh` →
17/17 unchanged golden-diff. All 3 real named tasks re-confirmed applying (max 56/51/53, frontmatter-
scoped scan). No other clause's verdict changed as a side effect.

## Not in scope / deferred

- Clause8's cutover logic itself (`N >= 40` threshold, what it checks once applying) — unchanged.
