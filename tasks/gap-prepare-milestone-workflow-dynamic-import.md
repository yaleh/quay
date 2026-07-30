---
id: gap-prepare-milestone-workflow-dynamic-import
title: prepare-milestone.js's DIR-126-C Stage-4 pre-check used
  await import('node:fs') to check for a prior generation record -- the
  workflow DSL has zero import/fs capability, so EVERY prepare-milestone
  dispatch with resumeFromAdjudicatedProposal omitted failed instantly;
  neither the Build's own audit nor an independent post-Land audit caught
  it because both used a mocked/direct-execution test harness that doesn't
  enforce this real sandbox restriction -- only a genuine Workflow dispatch
  surfaced it
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test plugin/test/prepare-milestone-convergence.test.mjs plugin/test/prepare-milestone-preparation-e2e.test.mjs
---
## Proposal

Remove `.claude/workflows/prepare-milestone.js`'s (+ `plugin/workflows/` mirror) unreachable
`await import('node:fs')` / `existsSync(...)` Stage-4 pre-check and dispatch
`proposal-convergence.ts --decide-resume` unconditionally whenever
`$a.resumeFromAdjudicatedProposal` is omitted, relying on `decideResumeGeneration`'s own
evaluation step 4 (missing/null `priorGenerationRecord` → `cold`) to correctly and safely handle a
never-before-seen task.

## Finding

Discovered 2026-07-29 by M203/DIR-126-D's own first real `prepare-milestone` dispatch
(`wf_4a6506c7-609`) — the run failed IMMEDIATELY (`duration_ms: 7149`, 1 agent) with `Error:
import() is not available in workflow scripts`. Direct read confirmed the cause:
`.claude/workflows/prepare-milestone.js` line 201 (introduced by DIR-126-C's own Build, commit
`2319e8e`, landed `8c9d114`) contained `const { existsSync } = await import('node:fs')` — an
"optimization" meant to skip the `--decide-resume` dispatch entirely when no prior generation
record file exists on disk. But this repo's own workflow DSL has confirmed ZERO fs/import
capability (documented repeatedly across this session's own commit history and CLAUDE.md's own
prior corrections) — every other file-touching operation in this same script already respects
that constraint via the `agent()`-wraps-real-CLI dispatch pattern; this one line did not.

**This is a genuinely serious finding about audit methodology, not just a code bug:** the defect
was invisible to BOTH the Build's own adversarial audit (verdict CONCERNS, not REFUTED — missed
it) AND a subsequent independent, fresh-context post-Land audit (verdict CONCERNS-affirmed — also
missed it, despite explicitly re-deriving every claim from source and live execution). Both audits'
"real, non-fixture" evidence for this code path came from a `loadWorkflow()`-style harness that
loads the script source as a real `AsyncFunction` and executes it directly in Node — which DOES
support `import()`, unlike the real `Workflow` tool's actual sandboxed runtime. Every
`prepare-milestone.js` test file in this repo uses exactly this harness. **A defect that only
manifests in the real Workflow tool's runtime, never in the AsyncFunction-harness tests, was
therefore structurally unreachable by this repo's entire existing test suite for this file** — it
took an actual `Workflow({scriptPath: ...})` dispatch (M203/DIR-126-D's own first real attempt,
the FIRST real dispatch of ANY prepare-milestone generation since DIR-126-C landed) to surface it.
Every prior "real, non-fixture dispatch" DoD claim for DIR-126-C (and, by the same reasoning, any
future child) should be understood as verified against the AsyncFunction-harness proxy, not
literally the production runtime, unless a genuine `Workflow()` dispatch specifically exercised it.

## Requested action

1. Remove the `await import('node:fs')`/`existsSync` pre-check from
   `.claude/workflows/prepare-milestone.js` (+ `plugin/workflows/` mirror); dispatch
   `--decide-resume` unconditionally when the flag is omitted.
2. Fix the 3 existing tests whose assertions depended on the old (broken) zero-dispatch-on-no-record
   behavior, and add `resume-decision` mock handling to `plugin/test/prepare-milestone-preparation-
   e2e.test.mjs`'s agent mock (it had none at all, since that file predates DIR-126-C's Build).
3. Re-verify no regression: `plugin/test/prepare-milestone-convergence.test.mjs` (52/52),
   `plugin/test/prepare-milestone-preparation-e2e.test.mjs` (2/2).

## Acceptance Criteria

- [x] The unreachable `import('node:fs')`/`existsSync` pre-check is removed from both
  `.claude/workflows/prepare-milestone.js` and the byte-identical `plugin/workflows/` mirror
  (`cmp`, zero output); `--decide-resume` is dispatched unconditionally whenever
  `resumeFromAdjudicatedProposal` is omitted.
- [x] All affected tests updated and passing: `plugin/test/prepare-milestone-convergence.test.mjs`
  52/52, `plugin/test/prepare-milestone-preparation-e2e.test.mjs` 2/2.
- [x] Real, non-fixture evidence: a fresh `Workflow({scriptPath: '.claude/workflows/prepare-
  milestone.js', ...})` dispatch for DIR-126-D/M203 (the same real dispatch that surfaced this
  bug) reaches at least the `Preflight` phase without the `import() is not available` error.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/prepare-milestone.js`, the control-plane script every future milestone's
  Prepare stage runs through — a defect here blocks ALL Prepare dispatches with the flag omitted,
  not just DIR-126-D's own).
- [x] Real, non-fixture evidence: the fix was verified by a genuine `Workflow()` dispatch reaching
  past the point of the original failure, not merely re-running the AsyncFunction-harness tests
  that failed to catch the original defect.

## Touches

- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- plugin/test/prepare-milestone-convergence.test.mjs
- plugin/test/prepare-milestone-preparation-e2e.test.mjs
