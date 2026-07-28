---
id: gap-execute-milestone-no-worktree-isolation
title: "gap: execute-milestone.js's Build phase has no worktree isolation —
  CLAUDE.md's documented per-milestone worktree claim is stale, and two
  milestones can never safely run concurrently regardless of task Touches"
status: todo
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Either (a) explicitly document and accept that `execute-milestone` dispatches must always be
strictly serialized against this repo (no worktree isolation exists or is planned generally), or
(b) design and implement real worktree-based isolation for ordinary (non-composite) `execute-
milestone` dispatches, so unrelated, file-disjoint milestones can genuinely run concurrently
without racing on the shared working tree. This directive does not pre-select an answer — it
records the real, current gap and the concrete trade-off, for a deliberate decision.

## Plan

N/A — directive resolved via a milestone once a decision is made between the two Proposal
options; if option (b) is chosen, a checked `docs/plans/*.md` is required given it touches the
Build/Land control plane.

## Finding

Discovered 2026-07-28 while planning concurrent dispatch of two disjoint gap-task fixes. Real code
read of `.claude/workflows/execute-milestone.js`'s Build-phase prompt: it instructs the dispatched
agent to "Edit/create files as needed... Run tests... COMMIT all changes" directly, with zero
`git worktree add` step — confirmed this is the actual, current behavior for M187 through M191
(each explicitly noted in its own Execution record as "direct-to-master build, no separate
worktree"). The Land-phase prompt still contains "MERGE the iteration worktree into master" text,
which is vestigial for the now-default no-worktree path (it would only apply if a Build agent
independently chose to create its own worktree, which none of M187-M191 did).

This directly contradicts `CLAUDE.md`'s own documentation ("Per-milestone work happens in
`milestones/M<NN>/worktrees/iteration-{0,1}` worktrees merged into `master` at ABSORB") — corrected
in place as part of filing this task. The practical consequence: **pairwise task-level `## Touches`
orthogonality (`touches-orthogonality-check.ts`) proves task-content safety but says nothing about
working-tree safety** — two `execute-milestone` dispatches, even for fully disjoint tasks, cannot
run concurrently today without a real risk of one's uncommitted Build-phase state colliding with
the other's, because both operate directly on the same shared working tree with no isolation
boundary between them.

Related but narrower: DIR-119-D's own design (composite phase-DAG Build) already plans to use
`isolation:'worktree'` for phases whose Touches overlap WITHIN a single composite dispatch — that
is a different, narrower mechanism (intra-composite phase isolation) and does not address the
broader question of whether two SEPARATE, top-level `execute-milestone` milestones could ever run
concurrently.

## Requested action

1. Make an explicit choice between two options. Option (a): treat strict serialization of every
   milestone dispatch against this repo as the permanent operating rule — cheapest, already the de
   facto practice, just needs to become a decided, documented invariant rather than an implicit
   constraint discovered ad hoc. Option (b): build real isolation so ordinary dispatches can run
   genuinely concurrently — a per-milestone worktree created before Build, real work done there,
   and a real merge-back plus cleanup step before Land, with Land itself as the sole serialization
   point rather than the whole Build phase.
2. If (b): update Land's "MERGE the iteration worktree into master" instruction to match real
   Build behavior (currently describes an action Build never takes), and add fixtures proving two
   concurrently-dispatched, file-disjoint milestones' Build phases do not corrupt each other's
   state.
3. Either way, `CLAUDE.md`'s worktree claim must stay accurate going forward — already corrected
   in this task's own filing commit.

## Acceptance Criteria

- [x] `CLAUDE.md`'s stale worktree claim is corrected to describe real current behavior. -- [fixed
  2026-07-28, same commit as this task's filing.]
- [ ] A decision between options (a)/(b) above is recorded (in this task's own Resolution, or via
  a follow-on directive if (b) is chosen) — not left implicit.
- [ ] If (b) is chosen: two real, file-disjoint `execute-milestone` dispatches run genuinely
  concurrently (real journal evidence — overlapping timestamps, no shared-tree corruption) and
  both land correctly.
- [ ] If (a) is chosen: the serialization rule is stated as an explicit, checkable invariant
  somewhere a future orchestrating session/agent will actually read before considering concurrent
  dispatch (this task + the `CLAUDE.md` correction already satisfy this).

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] The decision (a) or (b) is landed on `master` with real evidence, not left as an open
  question.

## Human verification when exp5 marks this task done

1. Is it now explicit, somewhere a fresh session would find it, whether concurrent
   `execute-milestone` dispatch is ever safe — and under what real mechanism if so?

## Touches

- CLAUDE.md
- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js
