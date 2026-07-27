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
