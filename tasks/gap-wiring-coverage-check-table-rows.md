---
id: gap-wiring-coverage-check-table-rows
title: wiring-coverage-check.ts's splitSentences merged Markdown pipe-table
  rows into one giant sentence, hiding per-row wiring claims from independent
  AC coverage -- fixed by treating table rows as list-aware block boundaries,
  regression-tested against the existing suite
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
---
## Proposal

Extend `wiring-coverage-check.ts`'s `splitListAwareBlocks` (already list-aware for `-`/`*`/`1.`
bullets since `335317d`) to also treat a Markdown GFM table row (`| cell | cell |`) as its own
block boundary, so a dense comparison table — this repo's own authoring convention frequently
produces "Code | Class | Reuses"-style tables in Proposal prose — no longer merges every row's
distinct wiring claim into one giant sentence the checker either can't extract as a claim at all
(too many identifiers) or extracts as one claim no single AC bullet was ever written to cover.

## Finding

Discovered 2026-07-29 during M201/DIR-126-B's own real `prepare-milestone` ProposalReview
generation: the real `wiring-coverage-check.ts` tool returned 15 blocking findings against the
reconciled Proposal, and `splitSentences` merging a 5-row `| Code | Class | Reuses |` comparison
table into one giant claim was independently identified as a real, reproducible checker defect
(distinct from the `335317d` bullet-list class it did not cover) by that same ProposalReview run's
own review agent, cross-checked by direct source read of `splitListAwareBlocks`'s `bulletStart`
regex (`/^\s*(?:[-*]\s+|\d+\.\s+)/`, no `|` alternative). Same root-cause class as
`gap-wiring-coverage-check-merged-markdown-list`, now reproduced against a different Markdown
construct.

Note: the same ProposalReview run also surfaced that `WIRING_VERB_RE` doesn't recognize
"imports"/"reuses"/"parses"-style reuse-relationship verbs, silently skipping those claims
entirely. Extending the verb list was evaluated and REJECTED here — a live check against
`tasks/DIR-126-A.md` and `tasks/DIR-119-D1.md` (both already `status: done`, already landed and
audited) showed the wider verb set introduces new uncovered-claim findings on that already-closed,
already-audited work, which is a worse cost than the narrow verb-recognition gap it would close.
The verb list is left unchanged; DIR-126-B's specific content gap (WIRING-CLAIM 5/6/7 not mapped to
any AC bullet) was instead closed directly in that task's own AC text.

## Requested action

1. Extend `splitListAwareBlocks`'s `bulletStart` regex (in
   `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` + `plugin/scripts/`
   mirror) to also match a line starting with `|` (a GFM table row), so each row — including the
   header and separator rows, which simply produce no-claim blocks — becomes its own
   list-aware block.
2. Add a regression test: a 3-row pipe table with one mechanism claim per row splits into 3
   independent single-row claims, not one merged claim.
3. Re-verify no regression on already-passing real tasks (DIR-119-D1 and the DIR-126 family).

## Acceptance Criteria

- [x] The `bulletStart` regex in both the canonical
  `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` and the byte-identical
  `plugin/scripts/wiring-coverage-check.ts` mirror now matches GFM table-row lines (`cmp`, zero
  output).
- [x] A new regression test confirms the fix: a 3-row pipe table produces 3 independent
  single-row claims (not one merged multi-identifier claim). Full suite: 18/18 pass (`node
  --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`).
- [x] No regression on real, already-passing tasks: `tasks/DIR-119-D1.md` and `tasks/DIR-126-A.md`
  both stay `wiring-coverage-complete` after the fix (confirmed via direct re-run).
- [x] The fix is strictly additive (only ever creates MORE sentence-split points, never fewer) —
  verified by construction, same reasoning as `335317d`.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master` under human-steered discipline (this touches the shared
  `wiring-coverage-check.ts` module both DIR-117 and DIR-122 depend on).
- [x] Real, non-fixture evidence: M201/DIR-126-B's own real Proposal's "Reuses" comparison table
  went from one giant merged claim to 5 independent per-row claims after this fix landed, confirmed
  via direct before/after re-run of the real CLI against the real task file.

## Touches

- experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- plugin/scripts/wiring-coverage-check.ts
- experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
