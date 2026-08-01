---
id: DIR-124-A
title: Establish milestone-workflow observability, invariant ownership, and
  golden replay before control-plane refactoring
status: todo
labels:
  - directive
  - human-steered
parent: DIR-124
children:
  - DIR-124-A1
  - DIR-124-A2
  - DIR-124-A3
  - DIR-124-A4
  - DIR-124-A5
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

## Proposal

Create a behavior-preserving measurement and replay boundary for the installed milestone workflow
before [[DIR-123]] and later DIR-124 children change its control plane. Emit structured stage events,
inventory every load-bearing invariant and its intended single owner, and build a replay corpus that
separates intentional compatibility from known defects.

This is C0 of
`docs/proposals/quay-milestone-workflow-git-crystallization.md`. It must observe current behavior
without introducing stage scheduling, new lifecycle policy, or a second journal format that
DIR-124-B later has to preserve.

**Split 2026-08-01 (DIR-026 SPLIT-OR-COMMIT):** a real `prepare-milestone.js` `ProposalReview`
returned `needs-human`/`split-recommended`, code `split-multi-mechanism` ("candidate contains 5
independently landable mechanisms (> 2)"), `repairable: false`. Parent completion is exactly the
completion of the children, in order:

1. [[DIR-124-A1]] — stage-event schema + emission instrumentation at the 8 boundaries. No
   dependencies.
2. [[DIR-124-A2]] — golden replay corpus: 8 named cases + the two known-defect shapes. Depends on
   A1's schema/stream.
3. [[DIR-124-A3]] — invariant-ownership manifest with single-authoritative-owner enforcement and a
   duplicate/deletion list. No dependencies.
4. [[DIR-124-A4]] — workflow-metadata vs executable-driver conformance check. No dependencies.
5. [[DIR-124-A5]] — baseline metrics emission (mechanical/content split, explicit unknowns). Depends
   on A1's event stream.

This parent is not independently SELECTable — each child carries its own full
Proposal/Plan/AC/DoD and is dispatched (prepared + executed) on its own.

**Correction (split review 2026-08-01):** the original Proposal anchored the replay boundary
"before [[DIR-123]] … change its control plane," but DIR-123 is already done (commit 059b5b16) and
its worktree isolation is live in the installed workflow. The before-state must be re-anchored to
before the later DIR-124 children (B/C/D/E) touch the workflow's control plane — not before DIR-123.

## Plan

N/A — parent directive resolved only through its ordered children. Parent completion is exactly the
completion of DIR-124-A1 through DIR-124-A5; the parent is not independently SELECTable.

## Finding

Recent workflow repairs have relied on prose histories and manually reconstructed Claude Code
timelines. Current workflow journals are inconsistent or merely mentioned by task acceptance text;
there is no canonical event schema covering queue/start/end time, agent calls, test commands,
working directory, observed effects, and commit identity. Without a before-state replay boundary,
DIR-123 and kernel extraction cannot distinguish a deliberate behavior change from another
accidental capability regression.

Naive golden snapshots are also dangerous: the current workflow contains known defects and stale
claims. A replay corpus must classify each captured behavior as normative, compatibility-only,
observed-but-undesired, or an explicitly open defect.

## Requested action

Execute DIR-124-A1, DIR-124-A2, DIR-124-A3, DIR-124-A4, DIR-124-A5 in order; each is independently
`prepare-milestone.js` + `execute-milestone.js` dispatched with its own real proof and independent
audit. Do not promote DIR-124-A to `done` until all five children are `done`.

## Acceptance Criteria

- [ ] DIR-124-A1 is `done`: one canonical stage-event schema is exercised by real workflow execution
  and records all fields named in the parent's Requested action item 1.
- [ ] DIR-124-A2 is `done`: replay fixtures cover all eight named cases plus the two known-defect
  shapes; each assertion is labeled normative/compatibility-only/known-defect.
- [ ] DIR-124-A3 is `done`: the invariant-ownership manifest rejects two authoritative owners and
  lists every known workflow/OUTER-LOOP/composite duplicate scheduled for deletion.
- [ ] DIR-124-A4 is `done`: a deliberately stale workflow metadata/driver claim fails the
  conformance check; the corrected claim passes.
- [ ] DIR-124-A5 is `done`: baseline measurements are emitted mechanically, separate
  mechanical/content agent calls, and report stage wall/queue time, agent-minutes, tokens, finding
  novelty/recurrence, and artifact-class output with explicit unknowns.
- [ ] Parent/child lifecycle consistency gate passes: this parent is `done` iff all five children
  are `done` — no PARENT-DONE-IFF-CHILDREN violation.

## Definition of Done

Standard exp5 DoD clauses apply.

- [ ] All five children are real-landed and independently audited.
- [ ] `it0-split-or-commit-check.ts .` reports no PARENT-DONE-IFF-CHILDREN violation.
- [ ] No child introduces post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign,
  stage scheduler, or resource lease (the parent AC9 non-goal is enforced per-child).

## Human verification when exp5 marks this DIR done

1. Can the before-state of every later DIR-124 refactor be replayed mechanically?
2. Are known defects clearly excluded from the normative compatibility contract?
3. Does the event stream show actual commands/effects rather than agent assertions about them?
4. Is each invariant assigned to one future owner?

## Touches

- `tasks/DIR-124-A1.md`
- `tasks/DIR-124-A2.md`
- `tasks/DIR-124-A3.md`
- `tasks/DIR-124-A4.md`
- `tasks/DIR-124-A5.md`
