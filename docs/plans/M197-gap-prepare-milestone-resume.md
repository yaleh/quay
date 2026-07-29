# M197 Plan — gap-prepare-milestone-cross-generation-no-incremental-reuse

- **Milestone:** M197
- **Task:** gap-prepare-milestone-cross-generation-no-incremental-reuse — prepare-milestone.js has
  no cross-generation incremental-reuse path (DIR-125 is within-generation only)
- **Charter:** `experiments/quay-perpetual-stream/charters/M197-gap-prepare-milestone-resume.md`
- **Base revision:** `ae42693` (current HEAD at Plan authoring)
- **Dispatch note:** hand-authored Plan, dispatched directly via `execute-milestone.js` without a
  `prepare-milestone.js` run (human-steered decision — running `prepare-milestone` on this task
  would retrigger the exact cross-generation problem the task exists to fix).

## Complete touch set

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`
- `plugin/scripts/proposal-convergence.ts`
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`
- `plugin/scripts/milestone-preparation-check.ts`
- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- `plugin/test/prepare-milestone-convergence.test.mjs`
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
- `docs/plans/M197-gap-prepare-milestone-resume.md`
- `milestones/M197/**`

This touch set is literally string-identical to the task's own `## Touches` list plus this Plan
file and the evidence directory (both implicitly covered by the same conventions M195/DIR-119-D
used).

## AC → stage map

| AC item | Stage(s) |
|---|---|
| AC 1 (resume-flag callsite, zero ProposalAuthors/Adjudicate dispatches) | Stage 1, Stage 4 |
| AC 2 (cold dispatch unchanged) | Stage 4 |
| AC 3 (fullSynthesisCount 0/1 semantics) | Stage 2, Stage 4 |
| AC 4 (RED/GREEN fixture, cold vs resumed) | Stage 4 |
| AC 5 (OUTER-LOOP + skill docs updated) | Stage 3 |
| AC 6 (real reproduction against a manually-fixed Proposal) | Stage 5 |
| AC 7 (resume-flag callsite real, non-selftest) | Stage 1 |
| AC 8 (OUTER-LOOP caller-contract real) | Stage 3 |
| AC 9 (fullSynthesisCount semantics across resume boundary) | Stage 2 |
| AC 10 (resume path never re-derives) | Stage 1, Stage 5 |

## Stages

### Stage 1: Add the resume-flag input and skip path to `prepare-milestone.js`
- AC: 1, 7, 10
- Files: .claude/workflows/prepare-milestone.js, plugin/workflows/prepare-milestone.js
- Command: node --test plugin/test/prepare-milestone-convergence.test.mjs

Class: code. Add `$a.resumeFromAdjudicatedProposal === true` handling immediately after the
existing `$a` normalization. When true: skip the `ProposalAuthors` and `Adjudicate` phases
entirely (no `agent()` dispatch for either), read the task's CURRENT `## Proposal` via `task_get`
as-is, and enter directly at `ProposalReview` using that text. When false/absent: behavior is
byte-for-byte unchanged from today (existing N-author + adjudicator dispatch). RED (pre-edit):
the flag has no effect, every dispatch runs authors. GREEN (post-edit): a resumed dispatch's
journal contains zero `proposal-author-*`/`adjudicate` labels.

### Stage 2: Thread `fullSynthesisCount` correctly across the new skip path
- AC: 3, 9
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- Command: node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs

Class: code. `prepare-milestone.js`'s Receipt phase already threads a `convergence` object
(including `fullSynthesisCount`) into `milestone-preparation-check.ts --build`. When the resume
path is taken, that value must be `0`; on the cold path it stays `1`. Add a unit test asserting
`validateConvergenceCounters` still fails closed on `fullSynthesisCount > 1` for a receipt
produced via either path — no new exemption is introduced.

### Stage 3: Update OUTER-LOOP.md and preparation-skill docs with the caller contract
- AC: 5, 8
- Files: experiments/quay-perpetual-stream/OUTER-LOOP.md
- Command: grep -n "resumeFromAdjudicatedProposal" experiments/quay-perpetual-stream/OUTER-LOOP.md

Class: prose. Add one paragraph to the `prepare(c)` step's STATUS note: after a
`prepare-milestone` dispatch returns `needs-human`/crashes and the on-disk Proposal is manually
repaired, the next dispatch should pass `resumeFromAdjudicatedProposal: true` rather than a bare
fresh call — mirroring (at the domain-semantic level, not the `Workflow` engine's cache level)
the existing `resumeFromRunId` guidance already documented for `Workflow` itself.

### Stage 4: RED/GREEN fixture for cold-vs-resumed dispatch
- AC: 1, 2, 3, 4
- Files: plugin/test/prepare-milestone-convergence.test.mjs
- Command: node --test plugin/test/prepare-milestone-convergence.test.mjs

Class: code (test). RED: a fixture drives the real (unmodified pre-Stage-1) workflow source and
confirms a task with a zero-finding Proposal still re-derives from scratch (author dispatches
present in the mock's recorded calls). GREEN (post-Stage-1): the same fixture, now driving the
patched source with `resumeFromAdjudicatedProposal: true`, shows zero author/adjudicate calls and
reaches `ProposalReview`; a second case confirms the cold path (flag omitted) still shows the
full N-author + adjudicator call set, unchanged.

### Stage 5: Real reproduction on a live task and DoD evidence
- AC: 6, 10
- Files: milestones/M197/**
- Command: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh gap-prepare-milestone-cross-generation-no-incremental-reuse experiments/quay-perpetual-stream/charters/M197-gap-prepare-milestone-resume.md milestones/M197/absorb-entry.md

Class: prose (real-run evidence capture) with a mechanical gate. Real dispatch of
`prepare-milestone.js` against a scratch/fixture task carrying a manually-fixed, zero-finding
Proposal, using the new resume flag; confirm it reaches `PlanAuthor`/`PlanCheck` without
discarding the fix, and that the journal contains zero `ProposalAuthors`/`Adjudicate` entries.
Record the journal path in the iteration report as evidence for AC 6/10 and DoD.
