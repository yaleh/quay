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
  before fix, GREEN after).
- [ ] The existing genuine mid-line-bullet-marker positive case (a real merged-claims block outside
  any code span) still correctly triggers the finding — this fix must not regress true positives.
- [ ] `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` (+ `plugin/test/`
  mirror) gain both regression fixtures above.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master`.
- [ ] Real, non-fixture evidence: re-running `prepare-admission-check.ts --preflight` against
  DIR-126-E's own real task body (at the commit that introduced the workaround reword, or an
  equivalent fixture reproducing the same shape) confirms the false positive no longer fires.

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs
