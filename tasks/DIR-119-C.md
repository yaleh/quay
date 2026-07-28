---
id: DIR-119-C
title: Prove SELECT-integrated arbitrary-width composite execution with a cold
  real generation and a SELECT-synthesized three-or-more-task milestone
status: todo
labels:
  - milestone-candidate
  - human-steered
parent: DIR-119
children: []
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

## Proposal

Provide the non-self-referential wiring proof for DIR-119-A/B. From a cold runtime generation
materialized after both implementations land, run the normal task pool through the new SELECT.
SELECT—not a human after selection—must synthesize, score, prepare, and choose a valid composite
containing at least three real tasks. Execute it through the installed arbitrary-width workflow,
read-only audit shards, deterministic reconciliation, gates, and atomic Land, then independently
audit primary artifacts and accounting.

The ≥3 requirement proves removal of the former two-task design assumption; it is a proof threshold,
not a production cardinality cap. If the real pool has no admissible ≥3-task group, leave this child
`todo`/`awaiting-real-composite-proof` rather than force unrelated tasks together.

## Plan

Depends on DIR-119-A and DIR-119-B. Execute Phase 3 / Stages 3.1–3.4 of
`docs/plans/adaptive-composite-milestone-select-and-execution.md`.

## Acceptance Criteria

- [ ] A cold runtime record identifies source commit, workflow script path/hash, dispatch form,
  materialization time, session identity, and runtime generation.
- [ ] Normal SELECT records singleton and composite alternatives and selects a composite containing
  at least three real tasks before final portfolio commitment.
- [ ] No task member is added by manual workflow arguments after SELECT; selected membership matches
  portfolio, preparation, charter, manifest, audit, and Land receipts.
- [ ] Preparation is stable or any drift visibly returns through bounded reselection before dispatch.
- [ ] The selected composite completes Verify, phase-DAG Build, read-only audit shards,
  deterministic Reconcile, task/bundle Gates, and atomic Land using the installed new workflow.
- [ ] Every task has correct AC/DoD verdict, status, milestone label, merge/provenance record, and
  evidence references.
- [ ] Dashboard records one composite milestone with task count; `milestone_counter` advances by
  exactly one.
- [ ] Negative control demonstrates a failing member/bundle verdict produces no partial lifecycle
  mutation on master.
- [ ] Focused and canonical full suites pass against the final integrated state.
- [ ] A fresh independent wiring auditor confirms SELECT synthesis, installed workflow reachability,
  audit immutability, reconciler ownership, atomicity, and accounting from primary artifacts.
- [ ] DIR-119 parent/child lifecycle gate passes after this child is reconciled done.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] A real SELECT-synthesized ≥3-task milestone completes under a cold later generation.
- [ ] Membership, task evidence, audit receipts, atomic Land, dashboard, and counter agree.
- [ ] Negative-control and canonical-suite evidence pass on the installed execution path.
- [ ] A fresh independent wiring audit finds no refutation.
- [ ] Source tests, fixture-only runs, a warm/cached workflow, a two-task composite, and
  hand-injected membership remain insufficient for completion.

## Touches

- `milestones/M-DIR119-C-CANARY/**`
- `experiments/quay-perpetual-stream/charters/M-DIR119-C-CANARY.md`
- `experiments/quay-perpetual-stream/dashboard.md`
- `experiments/quay-perpetual-stream/backlog.md`
- `tasks/DIR-119-C.md`
- runtime-generation and wiring-audit receipts selected by the checked Plan

## Audit disposition (2026-07-27/28, real run + independent wiring audit, session
`13efe277-45ff-4563-bcfe-fd2c3db3e2a5`) — AC/DoD boxes intentionally left unticked

The real M-DIR119-C-CANARY milestone ran (commits `23f43d5` Build, `044a807` Land) and was given a
fresh independent wiring audit. Recorded here for traceability; per DIR-020 the checkboxes above stay
`- [ ]` because the audit did NOT confirm the full AC set — ticking a subset would misrepresent this
task as partially adjudicated when what actually happened is a mixed verdict on genuinely different
claims bundled into this one directive.

**Confirmed real (durable primary evidence, not asserted):**
- A real `select-preflight.ts --json` invocation genuinely synthesized this exact 7-task composite
  as its top-scored candidate over 19 rejected alternatives and a recorded runner-up
  (`composite:DIR-099+DIR-103+DIR-104`, score 2.38) — not hand-typed. (Durability caveat: the only
  surviving trace is the session transcript plus a `/tmp` file that could be garbage-collected; the
  charter's claim that this JSON was "pasted in full in the committed iteration report" is false —
  `milestones/M-DIR119-C-CANARY/iterations/iteration-0.md` contains no such content.)
- Atomic Land: all 7 member tasks landed `status: done` with consistent accounting
  (`milestone_counter` 189→190 exactly once, one dashboard entry, matching backlog rows).
- Spot-checked substance of 2 of 7 member tasks (DIR-070, gap-config-wiring-check-symlink-noop) was
  real and independently reproduced, not rubber-stamped.

**NOT confirmed — this task's own AC #5 and #10 are unmet by the current implementation:**
- No phase-DAG Build: Build ran as one monolithic agent covering all 7 tasks, not per-manifest-phase
  dispatch.
- No read-only audit shards: exactly one Audit agent ran (not per the manifest's 4 declared
  `auditShardIds`), and it directly wrote task files/`dashboard.md`/the absorb entry — not read-only.
- No deterministic Reconcile: `execute-milestone.js` has no `Reconcile` phase; `composite-reconcile.ts`
  is real and tested but has zero production callsites.

**Found afterward by direct code reading (NOT caught by the dispatched independent audit itself —
its own checklist verified journal call-counts and AC-citation evidence but did not trace production
import graphs or exercise the Gate-phase failure branch):**
- No automated process converts a SELECT-produced `MilestoneCandidate.taskIds` into the manifest's
  `phases[]`/`auditShards[]` structure; the manifest used here was hand-authored. The only
  phase/shard-producing code (`makeValidCompositeFixture`) is explicitly test-fixture-only.
- Gate-phase failure handling mis-attributes any member's gate failure to `_primaryTaskId` only
  (did not trigger this run — all 7 gates passed).

**Disposition:** this task's SELECT-integration claim is genuinely proven; its execution-architecture
claim (phase-DAG/read-only-shard/Reconcile) is not. Closing the gap — plus the two independently
found defects and a fix to the audit's own blind spot — is now **[[DIR-119-D]]**. This task should be
re-adjudicated (checkboxes ticked where warranted, by a fresh independent audit, not self-service)
only after DIR-119-D lands with real evidence.
