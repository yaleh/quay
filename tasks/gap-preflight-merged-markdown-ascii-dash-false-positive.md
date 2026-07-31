---
id: gap-preflight-merged-markdown-ascii-dash-false-positive
title: preflight-merged-markdown-claims's mid-line-bullet regex also matches
  an ordinary ASCII " - " prose dash, not just a bullet marker -- currently
  dormant (0/495 real task files hit it), filed as a follow-up rather than
  blocking M201/DIR-126-B's fourth audit round
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
---
## Proposal

Tighten `preflightMergedMarkdownClaims`'s mid-line-bullet detection (`_MID_BULLET_RE` /
`/\S[ \t]+[-*][ \t]+\S/g`, `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`)
so it does not also match an ordinary ASCII " - " prose dash/aside — only a genuine bullet-marker
shape (e.g. requiring the token immediately following the `-`/`*` to itself look like the start of
a new claim, not just any word).

## Finding

Discovered 2026-07-29 by the fourth independent adversarial audit of M201/DIR-126-B (dispatched
specifically to hunt for false positives in the three detectors still calibrated `true`, after
three prior rounds found real defects in the other two). Constructed reproduction:

```
This change touches `foo.ts`, `bar.ts`, `baz.ts`, and `qux.ts` - all four files share one helper
module, so the refactor is contained.
```

The real CLI hard-blocks this ordinary prose (an ASCII hyphen aside, not a bullet list) with
`preflight-merged-markdown-claims`, `blocking:true`. The same sentence using this repo's actual
dominant em-dash style (`—`) does not trip it. A scan of all 495 task files (open + closed) found
**zero** instances of this exact shape (>=2 backtick tokens separated by an ASCII ` - `), so this is
a real but currently dormant gap — it does not affect any live `--preflight` dispatch today, and
`preflight-merged-markdown-claims` remains calibrated `true`/blocking pending this fix (downgrading
it preemptively, with zero real incidence, would be unwarranted per the same "Repair/calibrate"
discipline this repo's own precedent — `gap-preflight-bare-filename-false-positive` — applies: only
downgrade a detector once a REAL false positive is found, not a merely-constructible one).

## Requested action

1. Tighten the mid-line-bullet regex (or the block classification logic built on it) in
   `preflight-admission-check.ts` (+ `plugin/scripts/` mirror) so an ASCII " - " prose dash/aside no
   longer matches, while a genuine mid-line bullet marker (`- item`, `* item` immediately following
   other text on the same physical line) still does.
2. Add a regression test: the exact reproduction sentence above returns zero findings (or, at most,
   a non-blocking `preflight-ambiguous-merged-markdown-claims`), while the existing RED fixture
   (genuine mid-line-bulleted claim-crowding) still blocks.
3. Re-verify no regression: the existing merged-markdown-claims RED/known-good/ambiguous fixture
   trio and the full `prepare-admission-check.test.mjs` suite stay green.

## Acceptance Criteria

- [ ] The tightened regex/logic is real, wired in both the canonical
  `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` and the byte-identical
  `plugin/scripts/prepare-admission-check.ts` mirror (`cmp`, zero output). Implemented
  (`_looksLikeNewClaimStart`, see Execution record) and `cmp` confirmed zero output on both
  mirrors — but left UNCHECKED per explicit coordinator instruction (2026-07-31): a first design of
  this fix was independently reviewed and REFUTED (see Execution record), so this box stays open
  until a second independent review confirms the redesign, not merely self-asserted here.
- [ ] A new regression test confirms the ASCII-dash-prose reproduction no longer hard-blocks, while
  the existing genuine-mid-line-bullet RED fixture still does. Tests added and passing (see
  Execution record) but left UNCHECKED pending the same pending independent review.
- [ ] No regression: the existing `preflightMergedMarkdownClaims` RED/known-good/ambiguous tests and
  the full `prepare-admission-check.test.mjs` suite stay green. 82/82 pass in both mirrors (see
  Execution record) but left UNCHECKED pending the same pending independent review.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline (this touches the shared
  `prepare-admission-check.ts` module DIR-126-A/DIR-126-B/DIR-126-C all depend on). NOT checked:
  work is on an isolated git worktree/branch; landing on `master` is left to the orchestrating
  session's own independent review + merge step.
- [ ] Real, non-fixture evidence: the reproduction sentence dogfoods clean against the real CLI
  post-fix. Real-CLI dogfood re-run and passing after the redesign (see Execution record) but left
  UNCHECKED pending the pending independent review, per explicit coordinator instruction.

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs
- experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/ascii-dash-prose.md
- plugin/test/fixtures/preflight/merged-markdown-claims/ascii-dash-prose.md
- experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/code-span-subtraction.md
- plugin/test/fixtures/preflight/merged-markdown-claims/code-span-subtraction.md
- experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/frontloaded-identifiers-crammed-claims.md
- plugin/test/fixtures/preflight/merged-markdown-claims/frontloaded-identifiers-crammed-claims.md
- experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/trailing-identifier-ascii-dash-aside.md
- plugin/test/fixtures/preflight/merged-markdown-claims/trailing-identifier-ascii-dash-aside.md

## Execution record

**Round 1** (2026-07-31, isolated worktree agent): implemented together with the sibling task
`gap-preflight-merged-markdown-claims-code-span-subtraction-false-positive` as one coherent change,
since both false-positive shapes hit the same regex/logic. Design: `_findGenuineMidBullet` treated a
mid-bullet match as genuine iff another backtick-quoted identifier occurred ANYWHERE LATER in the
block. Self-marked `status: done`, AC/DoD checked.

**Independent review of round 1: REFUTED.** The reviewer found the "identifier occurs later"
direction was unsound in both directions:
1. False NEGATIVE (the serious defect): `"...`foo.ts`, `bar.ts`, `baz.ts`, and `qux.ts` - fix the
   null check in the first two - also rename the last two files for clarity."` is a REAL
   crammed-two-claims defect — exactly what this detector exists to catch — but all 4 identifiers
   are front-loaded BEFORE the dashes, so "identifier later" was false and the block silently
   passed with `ok:true`. A false negative here is worse than the false positive being fixed: it
   defeats a hard-blocking safety check.
2. The same design also didn't fully generalize the fix this task itself wanted: `"`foo.ts` - the
   main entry point - and also `bar.ts` for testing, plus `baz.ts` and `qux.ts` for good measure."`
   still hard-blocked, because `bar.ts` occurs later in the block (just not adjacent to either
   marker) — only the narrower "no identifier anywhere after" shape of the originally-constructed
   repro was actually fixed.

**Round 2** (2026-07-31, same session, responding to the review): redesigned around a
direction-agnostic, marker-adjacent signal instead. `_looksLikeNewClaimStart(tail)` looks only at
the single word immediately following each marker: genuine iff that word is a backtick-quoted
identifier directly, or a word NOT in `_CONTINUATION_STOPWORDS` (a closed-class list of
articles/conjunctions/prepositions/pronouns/quantifiers/discourse-connectors — "the", "and",
"also", "which", "with", etc. — deliberately a STOPLIST rather than a verb whitelist, since verbs
are open-class/unbounded and a whitelist would silently under-cover; an unlisted word defaults to
"looks like a claim", the safety-preferred direction). Re-verified against BOTH review
counterexamples plus the original two repros and the pre-existing RED/ambiguous fixtures — all 6
behave correctly (see sibling task's Execution record for the same verification, shared fix).

Regression tests added for both review counterexamples (`frontloaded-identifiers-crammed-claims.md`
→ must still block; `trailing-identifier-ascii-dash-aside.md` → must NOT block), on top of the
round-1 tests, to both `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` and
its byte-identical `plugin/test/` mirror. Full suite: 82/82 pass in both mirrors. `cmp` zero output
on the script mirror, test mirror, and all 4 new fixture mirrors (2 from round 1, 2 from round 2).

Real-CLI dogfood, re-run post-redesign (`prepare-admission-check.ts --preflight`, not the unit-test
harness, against scratch task files):
- This task's own repro (ASCII-dash prose) → `{"ok":true,...}`, no merged-markdown-claims finding.
- Review counterexample A (front-loaded identifiers, must block) →
  `{"ok":false,"findings":[{"code":"preflight-merged-markdown-claims","blocking":true,...}]}`.
- Review counterexample B (trailing identifier, must NOT block) → `{"ok":true,...}`, no
  merged-markdown-claims finding.

**Outcome:** fix redesigned, tests added, real-CLI dogfooded — all evidence above is real and
reproducible. AC/DoD boxes deliberately left UNCHECKED and `status` left at `todo` per the
coordinator's explicit 2026-07-31 instruction: round 1's self-assessment was wrong once already, so
this round does not re-assert `done` — a second independent review is expected before this task is
called done or landed.
