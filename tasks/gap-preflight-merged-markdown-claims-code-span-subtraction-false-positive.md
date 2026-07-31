---
id: gap-preflight-merged-markdown-claims-code-span-subtraction-false-positive
title: preflightMergedMarkdownClaims's mid-line-bullet regex misidentifies a
  backtick-wrapped subtraction expression (e.g. `endedAtMs - startedAtMs`) as
  a markdown bullet marker -- found live during DIR-126-E's round-4
  Preflight rejection
status: todo
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

- [ ] A fixture sentence with a backtick-wrapped subtraction expression (`` `a - b` `` shape) and
  >=4 other backtick identifiers is confirmed NOT flagged as `preflight-merged-markdown-claims` (RED
  before fix, GREEN after). Implemented and passing (see Execution record) but left UNCHECKED per
  explicit coordinator instruction (2026-07-31): the sibling task's fix for the SAME shared function
  was independently reviewed and REFUTED in its first design; this task's own code-span-exclusion
  mechanism was not itself the refuted part, but both fixes land together in one change, so this box
  stays open until the whole change gets a second independent review.
- [ ] The existing genuine mid-line-bullet-marker positive case (a real merged-claims block outside
  any code span) still correctly triggers the finding — this fix must not regress true positives.
  Confirmed still true post-redesign (`bad.md` still `blocking:true`) but left UNCHECKED pending the
  same pending independent review.
- [ ] `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` (+ `plugin/test/`
  mirror) gain both regression fixtures above. Done (both mirrors, byte-identical) but left
  UNCHECKED pending the same pending independent review.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master`. NOT checked: work is on an isolated git worktree/branch; landing on
  `master` is left to the orchestrating session's own independent review + merge step.
- [ ] Real, non-fixture evidence: re-running `prepare-admission-check.ts --preflight` against
  DIR-126-E's own real task body (at the commit that introduced the workaround reword, or an
  equivalent fixture reproducing the same shape) confirms the false positive no longer fires.
  Re-confirmed post-redesign (see Execution record) but left UNCHECKED pending the pending
  independent review, per explicit coordinator instruction.

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
`gap-preflight-merged-markdown-ascii-dash-false-positive` as one coherent change, since both
false-positive shapes hit the same regex/logic. This task's own fix — `_findGenuineMidBullet`
computing backtick code-span ranges and skipping any `_MID_BULLET_RE` match falling entirely inside
one (a math `-` inside `` `endedAtMs - startedAtMs` `` never reaches the "genuine bullet" check at
all) — is unconditionally correct and was NOT the part later refuted; the sibling task's ADDITIONAL
"identifier follows" check was. Self-marked `status: done`, AC/DoD checked.

**Independent review of round 1: REFUTED** (on the sibling task's own "identifier follows" logic,
not this task's code-span-exclusion mechanism — see that task's Execution record for the full
counterexamples). Because both fixes live in the same `_findGenuineMidBullet` function and land
together, this task's AC/DoD are held to the same re-review bar as the sibling's, even though its
own mechanism was not directly implicated.

**Round 2** (2026-07-31, same session): the sibling task's logic was redesigned around
`_looksLikeNewClaimStart` (marker-adjacent stopword check, see that task's Execution record for the
full design writeup). This task's own code-span-exclusion step is unchanged by that redesign — it
runs first, before `_looksLikeNewClaimStart` is even consulted, so a match fully inside a
`` `...` `` code span is excluded exactly as before.

Regression tests for the sibling task's two new counterexamples were added in the same pass (they
exercise the shared function, so both mirrors' full suites are the correct regression surface for
this task too). Full suite: 82/82 pass in both `experiments/quay-perpetual-stream/test/` and
`plugin/test/` mirrors. `cmp` zero output on the script mirror, test mirror, and all 4 fixture
mirrors touching this shared function (2 from round 1 including this task's own
`code-span-subtraction.md`, 2 new from round 2).

Real-CLI dogfood, re-run post-redesign (`prepare-admission-check.ts --preflight`, not the unit-test
harness): a scratch task whose Finding section reproduces both cited instances from this task's own
Finding (`` `recordedAtMs - admission.acquiredAt` `` and `` `endedAtMs - startedAtMs` ``) still
returns `{"ok":true,"findings":[]}` — zero findings, unaffected by the sibling task's redesign.

**Outcome:** fix (code-span exclusion) unchanged and still correct through the redesign; tests
added; real-CLI dogfooded. AC/DoD boxes deliberately left UNCHECKED and `status` left at `todo` per
the coordinator's explicit 2026-07-31 instruction covering the whole shared change — a second
independent review is expected before this task is called done or landed.
