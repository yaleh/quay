---
id: gap-preflight-merged-markdown-ascii-dash-false-positive
title: preflight-merged-markdown-claims's mid-line-bullet regex also matches
  an ordinary ASCII " - " prose dash, not just a bullet marker -- currently
  dormant (0/495 real task files hit it), filed as a follow-up rather than
  blocking M201/DIR-126-B's fourth audit round
status: done
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

- [x] The tightened regex/logic is real, wired in both the canonical
  `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` and the byte-identical
  `plugin/scripts/prepare-admission-check.ts` mirror (`cmp`, zero output). (`_findGenuineMidBullet`
  now requires a further backtick-quoted identifier to follow a mid-bullet match before treating it
  as a genuine bullet marker — a bare ASCII " - " prose aside with no identifier after it no longer
  counts. `cmp experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
  plugin/scripts/prepare-admission-check.ts` — zero output, confirmed.)
- [x] A new regression test confirms the ASCII-dash-prose reproduction no longer hard-blocks, while
  the existing genuine-mid-line-bullet RED fixture still does. (New fixture
  `experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/ascii-dash-
  prose.md` (+ byte-identical `plugin/test/` mirror) uses the exact reproduction sentence from this
  task's Finding; new test "ascii-dash-prose false positive" asserts
  `preflightMergedMarkdownClaims` returns `null`. The pre-existing RED fixture (`bad.md`) still
  returns `blocking:true` — unchanged, still covered by the pre-existing "RED/known-bad" test.)
- [x] No regression: the existing `preflightMergedMarkdownClaims` RED/known-good/ambiguous tests and
  the full `prepare-admission-check.test.mjs` suite stay green. (Full suite: 80/80 pass in both
  `experiments/quay-perpetual-stream/test/` and `plugin/test/` mirrors.)

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline (this touches the shared
  `prepare-admission-check.ts` module DIR-126-A/DIR-126-B/DIR-126-C all depend on). NOT checked:
  this task was executed in an isolated git worktree/branch per explicit dispatch instructions; the
  commit is real and self-contained but landing on `master` is deliberately left to the
  orchestrating session's own independent review + merge step, not asserted here.
- [x] Real, non-fixture evidence: the reproduction sentence dogfoods clean against the real CLI
  post-fix. (Real `prepare-admission-check.ts --preflight` CLI run — not the unit-test harness —
  against a scratch task file containing the exact Finding-section reproduction sentence:
  `{"ok":true,...}` with no `preflight-merged-markdown-claims`/`preflight-ambiguous-merged-markdown-
  claims` finding in the `findings` array; the only finding present is an unrelated,
  already-non-blocking `preflight-missing-precedent` about the fixture's fabricated filenames.)

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs
- experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/ascii-dash-prose.md
- plugin/test/fixtures/preflight/merged-markdown-claims/ascii-dash-prose.md
- experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/code-span-subtraction.md
- plugin/test/fixtures/preflight/merged-markdown-claims/code-span-subtraction.md

## Execution record

Implemented together with the sibling task
`gap-preflight-merged-markdown-claims-code-span-subtraction-false-positive` as one coherent change
to `preflightMergedMarkdownClaims`'s mid-bullet detection, since both false-positive shapes hit the
exact same regex/logic (2026-07-31, dispatched to an isolated worktree agent).

Fix: introduced `_findGenuineMidBullet(block)`, which (a) computes backtick code-span ranges in the
block, (b) skips any `_MID_BULLET_RE` match falling entirely inside a code span (closes the sibling
task's code-span-subtraction false positive), and (c) only treats a surviving match as a genuine
bullet marker if another backtick-quoted identifier follows it later in the block — the real shape
of "two claims crammed onto one line" is `` `A` - text `B` ``; a trailing ASCII " - " prose aside
with no further identifier after it (this task's false-positive shape) does not qualify.

Verification: sanity-checked all four cases directly (existing RED fixture still `blocking:true`,
existing ambiguous fixture still `reviewer-required`, both new false-positive fixtures `null`)
before running the full suites. `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
and `plugin/test/prepare-admission-check.test.mjs`: 80/80 pass each, byte-identical
(`cmp` zero output on both the script and test mirrors, plus the two new fixture mirrors).
Real-CLI dogfood: `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/
prepare-admission-check.ts --preflight --taskId T-ASCII-DASH --workspace <scratch>` against a
scratch task whose Finding section contains this task's exact reproduction sentence returned
`ok:true` with no merged-markdown-claims finding.

**Outcome:** done (code+tests landed on this branch; `master` landing left to the orchestrating
session per dispatch instructions — see DoD note above).
