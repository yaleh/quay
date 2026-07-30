---
id: gap-wiring-coverage-check-whose-own-and-bold-marker-splitting
title: wiring-coverage-check.ts's WIRING_VERB_RE false-triggers on "whose own"
  (possessive-determiner exclusion list omits "whose") and its sentence
  splitter never breaks before a markdown bold marker (**), letting
  unrelated bulleted sub-points merge into one oversized "claim" --
  found live during DIR-126-D's round-4/5 ProposalReview convergence
  when the milestone's own explanatory prose kept re-triggering
  uncovered-claim findings
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs plugin/test/wiring-coverage-check.test.mjs
---
## Proposal

Fix two confirmed defects in `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`
(+ `plugin/scripts/` mirror):

1. `WIRING_VERB_RE`'s possessive-determiner negative lookbehind
   (`(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b`) omits `whose` — plain English like
   "the terminal **whose own** AC requires..." false-triggers `\bowns?\b` as a wiring verb, since
   "whose" isn't in the excluded-word list. Add `whose` to the lookbehind alternation.
2. `splitSentences()`'s sentence-boundary regex (`(?<=[.!?])\s+(?=[A-Z`"])`) requires the text
   immediately after a sentence-ending punctuation mark to start with an uppercase letter, backtick,
   or quote — but never a markdown bold marker (`**`). A run-on explanatory paragraph like
   `"...done. **Claim A is X.** **Claim B is Y.**"` never splits at the `. **Claim B` boundary,
   merging multiple genuinely distinct claims (with disjoint identifier sets) into one oversized
   "claim" spanning identifiers from unrelated sentences. Extend the lookahead to also match `\*\*`.

## Finding

Discovered 2026-07-30 during DIR-126-D's (M203) real `prepare-milestone` ProposalReview convergence
(rounds 4-5 of a 5-round real bounded-convergence loop, run IDs `wf_929eb86d-2a6`/`wf_750f506a-3d2`).
Round 4 added a "Why one milestone, not eight" explanatory section (a real, honest SPLIT-OR-COMMIT
justification, not new mechanism claims) written as prose with `**Claim N...**`-prefixed points and
a sentence using "the one terminal whose own AC explicitly requires..." — both defects fired on this
same paragraph: the bold-marker splitting failure merged 4+ unrelated sub-points (spanning
`--ledger`, `buildReceipt`, `checkPreparation`, `mechanismCount=5`, and separately `Date.now()`,
`import()`, two commit hashes) into oversized "claims" the checker then correctly-per-its-own-logic
flagged as uncovered — but the underlying content was already covered by each Claim's own paragraph
elsewhere in the document; the false claim was purely an artifact of failed sentence splitting. This
consumed a full extra ProposalReview round (~20 real minutes, 12 agents, ~700K tokens) to
work around by manually restructuring the paragraph into a bullet list (which the checker's
list-aware splitter already handles) rather than being caught immediately by the tool.

Both defects were confirmed via direct source read (not inference) before filing:
`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` line 50 (verb regex) and line
102 (sentence splitter), both reproduced against the exact live paragraph that triggered them in
`tasks/DIR-126-D.md`'s commit history (`83c1958`).

## Requested action

1. Add `whose` to `WIRING_VERB_RE`'s possessive-determiner exclusion lookbehind.
2. Extend `splitSentences()`'s lookahead to also split before `**` (markdown bold).
3. Add regression fixtures: (a) a sentence containing "whose own" that must NOT be treated as a
   wiring-verb claim; (b) a paragraph with two `**Bold-prefixed.** **Bold-prefixed.**` sentences
   that must split into two separate claims, each independently checked for AC coverage.
4. Re-run `wiring-coverage-check.ts --task tasks/DIR-126-D.md` against the current (already fixed
   via manual restructuring) task body and confirm it still reports `ok:true` post-fix (i.e. the fix
   doesn't regress the now-bulleted structure).

## Acceptance Criteria

- [ ] `WIRING_VERB_RE`'s exclusion lookbehind includes `whose`; a fixture sentence "the terminal
  whose own AC requires X" is confirmed NOT flagged as a wiring-verb claim (RED before fix, GREEN
  after).
- [ ] `splitSentences()` splits before a `**` bold marker; a fixture paragraph
  `"Done. **A does X (\`id1\`, \`id2\`).** **B does Y (\`id3\`, \`id4\`).**"` produces two distinct
  sentences with disjoint identifier sets (RED before fix — one merged sentence with all 4
  identifiers; GREEN after — two sentences with 2 identifiers each).
- [ ] `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` (+ `plugin/test/`
  mirror) gain regression tests for both fixtures above.
- [ ] Re-running `wiring-coverage-check.ts --task tasks/DIR-126-D.md` against the current committed
  task body after the fix still reports `ok:true`/0 findings (no regression on the real document
  that surfaced this).
- [ ] Grounding evidence (exhaustive identifiers, wiring-coverage completeness): direct source read
  confirmed `WIRING_VERB_RE`'s current lookbehind
  `(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b` omits `whose`, so `\bowns?\b` still
  matches inside "whose own" — reproduced and closed by AC item 1 above's fixture.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master`.
- [ ] Real, non-fixture evidence: both fixtures above pass; a real run of
  `wiring-coverage-check.ts --task tasks/DIR-126-D.md` (or its state at time of fix) confirms no
  regression.

## Touches

- experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- plugin/scripts/wiring-coverage-check.ts
- experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
- plugin/test/wiring-coverage-check.test.mjs
