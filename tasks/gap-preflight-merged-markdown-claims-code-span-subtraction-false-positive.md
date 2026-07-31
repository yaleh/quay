---
id: gap-preflight-merged-markdown-claims-code-span-subtraction-false-positive
title: preflightMergedMarkdownClaims's mid-line-bullet regex misidentifies a
  backtick-wrapped subtraction expression (e.g. `endedAtMs - startedAtMs`) as
  a markdown bullet marker -- found live during DIR-126-E's round-4
  Preflight rejection
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs plugin/test/prepare-admission-check.test.mjs
---
## Proposal

Fix `preflightMergedMarkdownClaims`'s mid-line-bullet-marker regex
(`experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`, `+ plugin/scripts/`
mirror) to not match inside a backtick code span. The regex `/\S[ \t]+[-*][ \t]+\S/g` — meant to
catch a stray `- ` or `* ` bullet marker mid-sentence (a sign multiple distinct claims got merged
onto one un-split line) — also matches a plain subtraction expression written inside backticks,
e.g. `` `endedAtMs - startedAtMs` `` or `` `recordedAtMs - admission.acquiredAt` ``, since the regex
operates on the raw text and has no concept of code-span boundaries.

## Finding

Discovered 2026-07-30 during DIR-126-E's (M204) real `prepare-milestone` round-4 dispatch
(`wf_637a3dc9-035`) — Preflight rejected with `preflight-merged-markdown-claims` (blocking,
calibrated:true) citing evidence `"...telemetry-side wall time (\`recordedAtMs - admission.acquiredAt\`, both fields conf"`.
Live-reproduced: `/\S[ \t]+[-*][ \t]+\S/g` against `"...telemetry-side wall time (\`recordedAtMs - admission.acquiredAt\`, ..."` matches `"s - a"` (from `recordedAtMs - admission`) — a math subtraction operator inside a backtick code span, not a markdown bullet marker. A second, near-identical instance
(`` `endedAtMs - startedAtMs` ``) existed elsewhere in the same document and would very likely also
have triggered this (or the sibling `reviewer-required` ambiguous variant) on a future round.

Worked around live by rewording both instances to avoid a bare ` - ` inside backticks (`` `recordedAtMs` minus `` `` `admission.acquiredAt` `` etc.) — this task exists to fix the checker itself so future documents describing timestamp-subtraction formulas (a common, legitimate pattern for
this repo's own telemetry/receipt work) don't need the same workaround.

## Requested action

1. Exclude backtick-code-span content from `preflightMergedMarkdownClaims`'s mid-line-bullet-marker
   scan — e.g. strip (or blank out, preserving offsets if needed) `` `...` `` spans from each block
   before applying `/\S[ \t]+[-*][ \t]+\S/g`, matching the code-span-awareness convention other
   markdown-parsing checkers in this same file already use where relevant.
2. Add a regression fixture: a sentence containing a backtick-wrapped subtraction expression (e.g.
   `` `endedAtMs - startedAtMs` ``) alongside >=4 other backtick identifiers must NOT be flagged as
   `preflight-merged-markdown-claims`, while a genuine mid-line bullet marker outside any code span
   (the tool's own existing positive-case fixture, if one exists — check the test file) must still
   be flagged.

## Acceptance Criteria

- [x] A fixture sentence with a backtick-wrapped subtraction expression (`` `a - b` `` shape) and
  >=4 other backtick identifiers is confirmed NOT flagged as `preflight-merged-markdown-claims` (RED
  before fix, GREEN after). (New fixture
  `experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/code-span-
  subtraction.md` (+ byte-identical `plugin/test/` mirror): "`` `endedAtMs - startedAtMs` `` using
  `` `startedAtMs` ``, `` `endedAtMs` ``, `` `acquiredAtMs` ``, and `` `releasedAtMs` `` fields" — 5
  backtick identifiers total, including the subtraction span. Pre-fix (`_MID_BULLET_RE` applied to
  raw text with no code-span awareness) this shape hard-blocked with `blocking:true` — confirmed
  live in the sibling task's own Finding section (`recordedAtMs - admission.acquiredAt` reproduction
  against the unpatched regex). Post-fix: `preflightMergedMarkdownClaims` returns `null`.)
- [x] The existing genuine mid-line-bullet-marker positive case (a real merged-claims block outside
  any code span) still correctly triggers the finding — this fix must not regress true positives.
  (Pre-existing RED fixture `bad.md` — "Add `FooModule` - update `BarService` invokes `Baz` and
  `Qux` in one crammed line without separation." — still returns `blocking:true`, unregressed;
  covered by the pre-existing "RED/known-bad" test, which stays green.)
- [x] `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` (+ `plugin/test/`
  mirror) gain both regression fixtures above. (Both mirrors gained the SAME two new tests —
  "ascii-dash-prose false positive" (sibling task) and "code-span-subtraction false positive" (this
  task) — plus the two new fixture files each, byte-identical via `cmp`.)

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master`. NOT checked: this task was executed in an isolated git worktree/branch per
  explicit dispatch instructions; the commit is real and self-contained but landing on `master` is
  deliberately left to the orchestrating session's own independent review + merge step, not asserted
  here.
- [x] Real, non-fixture evidence: re-running `prepare-admission-check.ts --preflight` against
  DIR-126-E's own real task body (at the commit that introduced the workaround reword, or an
  equivalent fixture reproducing the same shape) confirms the false positive no longer fires. (Used
  the "equivalent fixture reproducing the same shape" branch of this clause, not the original
  DIR-126-E commit: real `prepare-admission-check.ts --preflight` CLI run — not the unit-test
  harness — against a scratch task whose Finding section reproduces BOTH cited instances verbatim,
  `` `recordedAtMs - admission.acquiredAt` `` and `` `endedAtMs - startedAtMs` `` alongside their
  named component identifiers, exactly matching this task's own Finding-section evidence quotes.
  Result: `{"ok":true,"findings":[]}` — zero findings at all, confirming the false positive no
  longer fires.)

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
`gap-preflight-merged-markdown-ascii-dash-false-positive` as one coherent change to
`preflightMergedMarkdownClaims`'s mid-bullet detection, since both false-positive shapes hit the
exact same regex/logic (2026-07-31, dispatched to an isolated worktree agent).

Fix: introduced `_findGenuineMidBullet(block)`, which computes backtick code-span ranges in the
block and skips any `_MID_BULLET_RE` match falling entirely inside a code span — this is this
task's own direct fix (a math `-` inside `` `endedAtMs - startedAtMs` `` never reaches the
"genuine bullet" check at all, since its match position is fully contained in a `` `...` `` span).
The sibling ASCII-dash task's fix (require an identifier to follow a surviving match) is additive
and does not affect this task's own code-span-exclusion mechanism.

Verification: sanity-checked directly (existing RED fixture still `blocking:true`, existing
ambiguous fixture still `reviewer-required`, both new false-positive fixtures `null`) before running
the full suites. `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` and
`plugin/test/prepare-admission-check.test.mjs`: 80/80 pass each, byte-identical (`cmp` zero output
on both the script and test mirrors, plus the two new fixture mirrors).
Real-CLI dogfood: `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/
prepare-admission-check.ts --preflight --taskId T-CODE-SPAN --workspace <scratch>` against a scratch
task whose Finding section contains both cited reproduction instances from this task's own Finding
returned `{"ok":true,"findings":[]}`.

**Outcome:** done (code+tests landed on this branch; `master` landing left to the orchestrating
session per dispatch instructions — see DoD note above).
