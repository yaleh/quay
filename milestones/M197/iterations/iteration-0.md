# M197 iteration-0 — Build report

**Task:** gap-prepare-milestone-cross-generation-no-incremental-reuse
**Milestone:** M197
**Charter:** experiments/quay-perpetual-stream/charters/M197-gap-prepare-milestone-resume.md
**Plan:** docs/plans/M197-gap-prepare-milestone-resume.md
**Base revision:** 34c7829 (M197 preparation commit, current HEAD at Build start)

## Summary

Added `$a.resumeFromAdjudicatedProposal === true` — an explicit caller opt-in — to
`prepare-milestone.js` (both `.claude/workflows/` and `plugin/workflows/` mirrors, kept
byte-identical). When set, the workflow skips the `ProposalAuthors` and `Adjudicate` phases
entirely (zero agent dispatches for either) and enters directly at `ProposalReview` using the
task's CURRENT on-disk `## Proposal` as-is. When false/absent (default), behavior is unchanged.
`fullSynthesisCount` is recorded as `0` for a resumed dispatch, `1` for a cold dispatch;
`validateConvergenceCounters`'s existing `fullSynthesisCount > 1` fail-closed check needed no code
change — it already generalizes to accept any value `<= 1`, `0` included. Documented the caller
contract in `OUTER-LOOP.md`'s `prepare(c)` step and in `quay-task-to-plan/SKILL.md` (both mirrors).

## Per-stage work

### Stage 1 — resume-flag input + skip path (AC 1, 7, 10)
- Files: `.claude/workflows/prepare-milestone.js`, `plugin/workflows/prepare-milestone.js`
- Wrapped the pre-existing `ProposalAuthors` + `Adjudicate` block in an `if (_resumeFromAdjudicatedProposal) { ... } else { ...existing code unchanged... }`.
  Resume branch: two `phase()` markers (unchanged phase-transition observability) + `log()` notes,
  zero `agent()` calls. `_proposals` defaults to `[]`, `adjudicateResult` to `null` when resumed.
- `_sessionIdInstruction` (used later by ProposalReview/PlanAuthor/PlanCheck prompts) hoisted above
  the branch so it is defined on both paths.
- Verified via `node --check`-equivalent (loaded as a real `AsyncFunction`, same technique the test
  suite uses) — no syntax errors; mirrors kept byte-identical (`diff` clean after `cp`).

### Stage 2 — `fullSynthesisCount` semantics (AC 3, 9)
- Files: `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` (no code change needed
  — `validateConvergenceCounters`'s `(fullSynthesisCount ?? 0) > caps.maxFullSynthesis` check
  already accepts 0 as well as 1), `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
  (2 new unit tests pinning this: `fullSynthesisCount=0` passes just like `1`; `fullSynthesisCount=2`
  — an abuse attempt claiming extra synthesis via either path — still fails closed with
  `convergence-full-synthesis-exceeded`).
- `.claude/workflows/prepare-milestone.js` / `plugin/workflows/prepare-milestone.js`: introduced
  `_fullSynthesisCount = _resumeFromAdjudicatedProposal ? 0 : 1`, threaded into `_convergence`, the
  final `return`, and the `Prepared:` log line.

### Stage 3 — OUTER-LOOP.md + skill doc caller contract (AC 5, 8)
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`: added a `RESUME CONTRACT` clause under the
  `prepare(c)` step naming the CLAUDE.md M144 `resumeFromRunId`/`Workflow`-level distinction and
  instructing that after a `needs-human`/crashed `prepare-milestone` dispatch is manually repaired,
  the next dispatch passes `resumeFromAdjudicatedProposal: true`.
  `grep -n "resumeFromAdjudicatedProposal" experiments/quay-perpetual-stream/OUTER-LOOP.md` → 2 hits.
- `.claude/skills/quay-task-to-plan/SKILL.md` / `plugin/skills/quay-task-to-plan/SKILL.md` (kept
  byte-identical): added an M197 note under contract 4 pointing back at the OUTER-LOOP.md contract.

### Stage 4 — RED/GREEN fixture (AC 1, 2, 3, 4)
- File: `plugin/test/prepare-milestone-convergence.test.mjs` — 4 new tests per mirror (8 total),
  driving the REAL unmodified workflow source (same `loadWorkflow`/mock-`agent()` technique the
  file's own pre-existing DIR-125 tests use):
  1. **RED**: cold dispatch (flag omitted) against a zero-finding-review task still runs the full
     2-author + 1-adjudicator dispatch, `fullSynthesisCount:1`, and the Adjudicate mock's
     `task_write` DOES overwrite the on-disk Proposal — the exact defect this milestone exists to
     let a caller opt out of.
  2. **GREEN**: same task, `resumeFromAdjudicatedProposal:true` — zero author/adjudicator
     dispatches, `fullSynthesisCount:0`, `## Proposal` section byte-identical before/after (`##
     Plan` legitimately still changes — PlanAuthor still runs), reaches `prepared`, and an
     independent `checkPreparation()` re-verification of the real receipt passes.
  3. Resume + persistent blocking finding still runs the ordinary bounded delta-review loop
     (2 delta rounds, `needs-human`/`delta-cap-exhausted`) — resume affects ONLY
     ProposalAuthors/Adjudicate, never DIR-125's own convergence bound.
- Fixed a bug in my own first draft of test #2: initially compared the WHOLE task-file body
  before/after (failed, because PlanAuthor legitimately updates `## Plan`) — corrected to compare
  only the extracted `## Proposal` section via a new `extractSection()` test helper.

### Stage 5 — real reproduction (AC 6, 10)
- This Build subagent has no `Workflow` tool available (dispatching a live multi-agent
  `prepare-milestone.js` run is out of scope for a Build-phase tool set) — so "real reproduction"
  here means the SAME technique this repo's own DIR-125/M195 fixtures already treat as the
  authoritative real-reproduction evidence for this workflow: driving the REAL, unmodified
  `prepare-milestone.js` source (not a reimplementation) as a live `AsyncFunction`, with a scripted
  mock `agent()` performing the SAME concrete actions (task_write, plan-file write, real
  `wiring-coverage-check.ts`/`milestone-preparation-check.ts` CLI invocations) a real LLM agent
  would. Stage 4's GREEN test IS this reproduction: a task carrying a Proposal (standing in for a
  manually-fixed, zero-finding one), dispatched with the resume flag, reaches `PlanAuthor`→
  `PlanCheck`→`Receipt`→`prepared` without the fix (Proposal section) ever being touched, and the
  resulting real receipt independently re-verifies via `checkPreparation()`.
- No live-Workflow dispatch was claimed or attempted — recorded honestly per DIR-026.

## Evidence — real command output

```
$ node --experimental-strip-types --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
ℹ tests 34
ℹ pass 34
ℹ fail 0

$ node --experimental-strip-types --test plugin/test/prepare-milestone-convergence.test.mjs
ℹ tests 26
ℹ pass 26
ℹ fail 0
(includes all 4 new M197 tests x 2 mirrors = 8 new passing tests)

$ node --experimental-strip-types --test plugin/test/prepare-milestone-preparation-e2e.test.mjs plugin/test/execute-milestone-preparation-gate.test.mjs
ℹ tests 16
ℹ pass 16
ℹ fail 0
(confirms the cold-dispatch e2e path and the Prepared-gate enforcement path are both unaffected)
```

`diff .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js` → no output
(byte-identical, maintained). Same for the two `quay-task-to-plan/SKILL.md` mirrors.

## Known gaps / deferred

- `milestones/M197/absorb-entry.md` does not exist yet at Build time — per the M195 precedent
  (`absorb-entry.md` is created by the ABSORB step, AFTER Build, e.g. commit `3316419` for M195
  came after the Build commit `c9ef805`), this is out of Build's scope; skipping the prompt's step
  1a (backlog-row surface tag) accordingly — it applies once absorb-entry.md exists.
- A `git status` scan found a pre-existing untracked `tasks/T-doc-gate-e2e-fixture.md` — unrelated
  to this milestone (a stray fixture from an unrelated test run), left untouched and NOT staged in
  this commit.
- `.halt` (repo root) and `experiments/quay-perpetual-stream/.halt` were already present
  (untracked) before this session started — not created or removed by this Build; left as-is per
  CLAUDE.md steering-hygiene guidance (removal requires the separate
  `restart-readiness-check.sh`, out of scope here).

## Files changed

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` (unchanged content — Plan's
  Stage 2 touch-set listing included it defensively; the fail-closed check already generalized)
- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- `plugin/test/prepare-milestone-convergence.test.mjs`
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
- `.claude/skills/quay-task-to-plan/SKILL.md`
- `plugin/skills/quay-task-to-plan/SKILL.md`
