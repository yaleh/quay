---
id: gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red
title: fan-in baseline comparison parses only TAP 'not ok' — spec-reporter ✖ /
  'test at file:line' ⇒ not-evaluated ⇒ develop-wide red misparked as
  unattributable needs-human
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Fan-in misattributes a develop-wide red as "unattributable" and parks a healthy task (2026-10-13 02:21 +0800).** After a red suite, fan-in compares the failure signatures against a develop baseline run, so that a red develop already carries is exempt. `plugin/scripts/worker-fan-in.ts` `parseFailureSignatures` (:1007) extracts signatures only from TAP shapes (`^not ok [N] - <head>: <detail>` …). The real suite output is node's spec reporter: `✖ <test name> (<ms>)` under `✖ failing tests:`, and identity is given by `test at <file>:<line>:<col>`.

Production reading:
- the suite log `.quay/fan-in-suite-gap-discovery-method-per-round-quota-verify-reserve-deep-reflection~wk-prod-anchor~1791828953643-00613d.log` has 0 `^not ok` lines, 5 `✖` lines and 2 `test at plugin/test/prod-data-audit.test.mjs:<line>` lines;
- the baseline log `…~baseline-1791829214376-1ab3bd.log` has the SAME 2 `✖` failing tests.

Even so, the fan-in step `baseline-red` returned `verdict:"not-evaluated", reason:"baseline-side signatures unevaluable: no-failure-signature-lines"`. Two rounds later the task was stopped and flipped to needs-human with the text 「失败无法归因」. In the same breath that text says the parser attributed 1 failing file. A red develop already carries should have been recognised as develop-wide (identical on both sides), not as an infrastructure mystery.

## Plan
1. The signature extractor recognises spec-reporter output:
   - the `✖ failing tests:` block;
   - each `test at <file>:<line>:<col>` paired with its following `✖ <name>` line;
   - the error code line (e.g. `code: 'ERR_…'`) as detail where present.
   Identity = (file, test name); `:line` is informative only, because line numbers drift between branches.
2. The TAP path stays unchanged. Mixed output (TAP + spec) yields the union, deduplicated.
3. The stop/needs-human text must not say "could not be attributed" when the parser attributed ≥1 file. Name the true state, e.g. `baseline comparison not evaluated: <reason>`.

## Acceptance Criteria
- [ ] AC1: a unit test feeds the extractor a verbatim excerpt of the production spec-reporter block (two `test at …prod-data-audit.test.mjs:N:1` + `✖` pairs) ⇒ `evaluated:true` with 2 signatures. The same excerpt on both sides ⇒ the comparison reports develop-wide (identical). Paste.
- [ ] AC2: format negative controls, each pasted:
  - (a) a spec log with NO `✖` and no `test at` ⇒ still `not-evaluated: no-failure-signature-lines`, so an absent signal is never read as "identical";
  - (b) a branch-side spec failure that the baseline lacks ⇒ NOT exempt;
  - (c) existing TAP fixtures give byte-identical results;
  - (d) remove the spec branch from the extractor ⇒ AC1 goes red.
- [ ] AC3: replay of the real 2026-10-13 pair: running the comparison on the two production logs named above yields "identical / develop-wide". Paste the verdict JSON.
- [ ] AC4: the needs-human/stop wording no longer contains 「无法归因」 when the attributed-file count is ≥ 1. Unit test plus pasted rendered text.

## Definition of Done
- `scripts/test.sh --for-task <this task>` green.
- The anti-drift, suite and baseline gates are not softened: a branch-only red still blocks.

## Touches
- tasks/gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red.md
- plugin/scripts/worker-fan-in.ts
- plugin/scripts/worker-driver.ts
- plugin/test/worker-fan-in-baseline-red.test.mjs
