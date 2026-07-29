---
id: gap-wiring-coverage-check-owns-false-positive
title: wiring-coverage-check.ts's WIRING_VERB_RE matches possessive "own"/"owns"
  (e.g. "the task's own AC section"), not just the ownership-verb sense —
  produces false-positive uncovered-claim findings on this repo's own
  ubiquitous "X's own Y" cross-referencing prose, and is the real root cause
  of the recurring "same wiring-coverage format defect" seen across DIR-119-D
  and DIR-119-D1
status: done
labels:
  - gap
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
---
## Proposal

Narrow `wiring-coverage-check.ts`'s `WIRING_VERB_RE` so the `owns?` alternative no longer matches
the ordinary possessive determiner "own" (as in "the task's own AC section", "on its own merits")
while still matching a real ownership-verb claim ("`composite-land.ts` owns `dashboard.md`"). Apply
identically to the canonical `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`
and its `plugin/scripts/` mirror (byte-identical, per this repo's existing sync-vendor discipline).

## Finding

Discovered 2026-07-29 while adjudicating DIR-119-D1's (M198) second `needs-human` round from
`prepare-milestone.js`'s `ProposalReview` phase. The mechanical `checkWiringCoverage()` reported 5
blocking "uncovered claim" findings against a Proposal that had already been manually corrected
twice for genuine content bugs. Direct inspection of each flagged sentence showed all 5 were
triggered by the same single word: "own", used as a possessive determiner ("this Proposal's own
scope", "the task's own AC section", "on its own merits", "the Chosen mechanism's own
wiring-claim paragraphs", "AC bullet 10's own wording") — never as the ownership verb the check is
meant to detect ("component X owns Y").

Confirmed mechanically, not just by inspection:
```
const WIRING_VERB_RE = /\b(invokes?|calls?|dispatches?|enforces?|wires?|owns?|routes?|delegates?)\b/i;
WIRING_VERB_RE.test("this Proposal's own scope")                    // true — false positive
WIRING_VERB_RE.test("the task's own AC section")                    // true — false positive
WIRING_VERB_RE.test("on its own merits")                             // true — false positive
```
Re-running `wiring-coverage-check.ts --task tasks/DIR-119-D1.md` against the CURRENT (twice
manually-corrected) Proposal confirmed `wiring-coverage-uncovered` with exactly these 5 claims and
no others — i.e. the checker was not finding real undocumented wiring, it was finding the word
"own".

This repo's own authoring convention (CLAUDE.md and every task body in `tasks/`) uses "X's own Y"
constantly for cross-referencing dense, self-referential prose ("the task's own AC section", "this
child's own scope", "this module's own merits"). That convention is structurally guaranteed to keep
re-triggering this false positive on any sufficiently detailed Proposal, which explains why "the
same wiring-coverage format defect" recurred identically across DIR-119-D (3 rounds, per
`gap-prepare-milestone-cross-generation-no-incremental-reuse`'s own Finding) and DIR-119-D1 (2
rounds) — no amount of Proposal-content rewording durably fixes it, because the repo's own writing
style keeps reintroducing the trigger word.

## Requested action

1. Narrow the ownership-verb alternative in `WIRING_VERB_RE` so it only matches when NOT
   immediately preceded by a possessive marker (apostrophe-s, s-apostrophe, or a possessive
   pronoun: its/their/my/our/your/his/her) — a negative lookbehind is sufficient and requires no
   NLP.
2. Apply identically to both the canonical script and its `plugin/scripts/` mirror.
3. Add regression tests: (a) a possessive "X's own Y"/"its own Y" sentence must NOT produce a
   mechanism claim; (b) the existing real ownership-verb usage ("`composite-land.ts` owns
   `dashboard.md`") must still produce one.
4. Re-verify against the real, currently-blocked task (`tasks/DIR-119-D1.md`) that the fix actually
   resolves the false positives without masking genuine uncovered claims.

## Acceptance Criteria

- [x] `WIRING_VERB_RE` in both `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`
  and `plugin/scripts/wiring-coverage-check.ts` no longer matches possessive "own"/"owns" — verified
  by direct regex test: `"this Proposal's own scope"`, `"the task's own AC section"`, `"on its own
  merits"`, `"the Chosen mechanism's own wiring-claim paragraphs"`, `"AC bullet 10's own wording"`
  all now test `false`.
- [x] Real ownership-verb usage still triggers — verified by the existing
  `extractMechanismClaims: multiple independent claims in one section` test (uses
  `` `composite-land.ts` owns `dashboard.md` writes during Land.``) continuing to pass, plus a new
  dedicated test asserting the same sentence alone still produces exactly 1 claim.
- [x] Canonical and `plugin/` mirror are byte-identical (`cmp`/`diff`, not merely asserted) —
  verified via `diff experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
  plugin/scripts/wiring-coverage-check.ts` (zero output).
- [x] `node --experimental-strip-types --test
  experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` passes 15/15 (13 pre-existing
  + 2 new), including the pre-existing RED-fixture test (proves the fix does not mask genuine
  uncovered claims) and the pre-existing "identifiers matched but no evidence keyword" test.
- [x] Re-running `node --experimental-strip-types
  experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts --task tasks/DIR-119-D1.md`
  against the real, currently-blocked task changes its verdict from `wiring-coverage-uncovered` (6
  claims, 5 uncovered) to `wiring-coverage-complete` (1 claim, 0 uncovered) — a real before/after
  command-output comparison, not asserted.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code and prose claims alone are necessary but insufficient — real
command output is required for every item above (see AC evidence). This fix was applied and
verified directly in the same session that discovered it (human-steered, no separate execute-
milestone dispatch) rather than via a full `prepare-milestone`/`execute-milestone` cycle, matching
the precedent this repo already uses for small, immediately-landable defects found mid-flight
(e.g. `gap-halt-sentinel-path-mismatch`, `gap-orphaned-check-scripts-not-wired`). No independent
adversarial audit pass has been run against this fix (unlike
`gap-prepare-milestone-cross-generation-no-incremental-reuse`'s 3-pass audit) — flagged here
honestly rather than silently omitted; a future audit sweep may still want to look at it.

- [x] Landed on `master` under human-steered discipline (touches
  `.claude/workflows/prepare-milestone.js`'s own `ProposalReview` dependency chain indirectly via
  the shared `wiring-coverage-check.ts` module DIR-117/DIR-122 both consume).
- [x] Real, non-fixture before/after evidence against the actual task that surfaced the defect
  (`tasks/DIR-119-D1.md`), not only synthetic unit-test fixtures.

## Human verification when exp5 marks this task done

1. Does the regex change actually eliminate the 5 specific false positives found on DIR-119-D1's
   Proposal, confirmed by rerunning the CLI against the real task file (not just unit fixtures)?
2. Does the existing real ownership-verb test case (`composite-land.ts` owns `dashboard.md`) still
   pass, confirming the fix didn't just disable the whole `owns?` alternative?
3. Are canonical and `plugin/` mirrors still byte-identical after the edit?

## Touches

- experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- plugin/scripts/wiring-coverage-check.ts
- experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
