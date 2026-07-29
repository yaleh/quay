---
id: gap-wiring-coverage-check-merged-markdown-list
title: wiring-coverage-check.ts's splitSentences merged dense, un-blank-lined
  Markdown bullet lists into one giant sentence, hiding per-bullet wiring
  claims from independent AC coverage -- fixed with a list-aware sentence
  boundary, additive and regression-tested against the existing suite
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
---
## Proposal

Make `wiring-coverage-check.ts`'s `splitSentences` treat every Markdown bullet-list line (`- `/
`* `/`1. `) as its own sentence boundary, so a dense, un-blank-lined bullet list — this repo's own
authoring convention produces these constantly in Proposal prose — no longer merges multiple
distinct wiring claims into one giant sentence the checker then either (a) can't extract as a claim
at all (too many identifiers to plausibly match one AC bullet) or (b) extracts as one claim whose
identifier set no single AC bullet was ever written to fully contain.

## Finding

Discovered 2026-07-29 during M199/DIR-126-A's own real `prepare-milestone` ProposalReview
generation: 13 of 17 mechanically-extracted claims came back uncovered, mostly from exactly this
merging (confirmed by direct inspection of the flagged claim sentences — dense bullet-list prose,
not genuinely uncovered content). This is the SAME root-cause class M198/DIR-119-D1 hit at commit
`f3d870b` (26 blocking findings, "dense, un-blank-lined Proposal bullet lists merging multiple
distinct wiring claims into one giant sentence") and DIR-126-B's own Proposal already named as its
target scope ("the wiring-coverage-check.ts merged-Markdown-list false-positive class closed at its
root") — but DIR-126-B depends on DIR-126-A landing first, so DIR-126-A's own real Prepare dispatch
hit the defect DIR-126-B was going to fix, before B could fix it. Fixed here directly as shared
infrastructure (mirroring the `gap-wiring-coverage-check-owns-false-positive` precedent) rather than
blocking on the dependency-ordered child.

## Requested action

1. Add `splitListAwareBlocks()` to `wiring-coverage-check.ts` (+ `plugin/scripts/` mirror): within
   one paragraph, a new block starts at every bullet-list line; a continuation line (indented,
   non-bullet-starting) stays part of the current block; text before the first bullet is its own
   block. Wire it into `splitSentences` between the existing paragraph split and the existing
   punctuation split.
2. Add regression tests: a dense bullet list splits into one claim per bullet (not one merged
   claim), and a continuation line under a bullet stays part of that bullet's own claim.
3. Re-verify no regression on already-passing real tasks (DIR-119-D1 and the DIR-126 family).

## Acceptance Criteria

- [x] `splitListAwareBlocks()` is real, wired into `splitSentences` in both the canonical
  `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` and the byte-identical
  `plugin/scripts/wiring-coverage-check.ts` mirror (`cmp`, zero output).
- [x] Two new regression tests confirm the fix: a 3-bullet list produces 3 independent
  single-identifier-pair claims (not one merged 6-identifier claim), and a continuation line stays
  attached to its own bullet's claim. Full suite: 17/17 pass (`node --experimental-strip-types
  --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`).
- [x] No regression on real, already-passing tasks: `tasks/DIR-119-D1.md` stays
  `wiring-coverage-complete` after the fix (confirmed via direct re-run, same as before).
- [x] The fix is strictly additive (only ever creates MORE sentence-split points, never fewer) —
  verified by construction (a claim that already qualified before the fix, >=2 identifiers + a
  wiring verb in one merged sentence, still qualifies after splitting, since splitting can only
  ever separate an already-2+-identifier sentence into smaller pieces or leave a single-bullet
  sentence unchanged, never combine previously-separate sentences).

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master` under human-steered discipline (this touches the shared
  `wiring-coverage-check.ts` module both DIR-117 and DIR-122 depend on).
- [x] Real, non-fixture evidence: M199/DIR-126-A's own real Proposal went from 6-9 mechanically
  uncovered claims (post-content-fixes, pre-this-fix) to 0 after this fix landed, confirmed via
  direct before/after re-run of the real CLI against the real task file.

## Touches

- experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- plugin/scripts/wiring-coverage-check.ts
- experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
