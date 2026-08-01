---
id: gap-prepare-milestone-no-size-aware-routing
title: prepare-milestone applies uniform full Proposal+Plan synthesis to every task regardless of implementation scale
status: todo
labels:
  - gap
  - defect
  - human-steered
parent: null
children:
  - gap-prepare-milestone-no-size-aware-routing-A
  - gap-prepare-milestone-no-size-aware-routing-B
  - gap-prepare-milestone-no-size-aware-routing-C
extra:
  schema: v1
---

**type:** execution

## Proposal

Add size-aware routing to prepare-milestone so small tasks don't pay the full Proposal+Plan
cost.

**Split 2026-08-01 (DIR-026 SPLIT-OR-COMMIT):** a real `prepare-milestone.js`
`ProposalReview` returned `split-multi-mechanism` (3 independently landable mechanisms >
2), `repairable: false`, with real findings (AC5 Verify-consumption had no
execute-milestone.js touch; proofScale classified but never affecting routing; tier
threshold conflict ~800 vs M-501-900; calibration count deviation). Parent completion is
exactly the completion of the children:

1. [[gap-prepare-milestone-no-size-aware-routing-A]] — size estimation + fast-lane routing
   (estimateTaskSize + PrepareRoutingDecision; proofScale genuinely gates routing;
   thresholds deferred to DIR-124-D).
2. [[gap-prepare-milestone-no-size-aware-routing-B]] — fast-lane execution manifest +
   execute-milestone Verify consumption (closes the AC5 Touches gap).
3. [[gap-prepare-milestone-no-size-aware-routing-C]] — calibration + rollout (shadow-mode,
   flag-gated auto-enable, reviewer findings in ledger).

This parent is not independently SELECTable — each child carries its own full
Proposal/Plan/AC/DoD and is dispatched on its own.

## Finding

The `prepare-milestone` workflow applies one nearly fixed-cost pipeline to every task:
competing ProposalAuthors → Adjudicate → ProposalReview → PlanAuthor → PlanCheck →
receipt. The 2026-07-31→08-01 product batch (S-size tasks through full-lane prepare)
showed this cost asymmetry sharply. The sizing proposal
(`docs/proposals/quay-milestone-workflow-task-sizing-and-adaptive-execution.md`)
establishes the two-dimension estimator and fast-lane/full-lane split. Full detail in each
child's Finding.

## Requested action

Execute the three children in order; each is independently prepared + executed with its own
real proof and independent audit. Do not promote the parent to `done` until all three
children are `done`.

## Acceptance Criteria

- [ ] gap-size-A is `done`: two-dimension routing where proofScale genuinely gates
  fast-lane; thresholds deferred to DIR-124-D.
- [ ] gap-size-B is `done`: fast-lane execution manifest consumed by execute-milestone
  Verify.
- [ ] gap-size-C is `done`: calibration/rollout with flag-gated auto-enable and durable
  reviewer findings.
- [ ] Parent/child lifecycle gate passes: this parent is `done` iff all three children are
  `done`.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] All three children are real-landed and independently audited.
- [ ] `it0-split-or-commit-check.ts .` reports no PARENT-DONE-IFF-CHILDREN violation.

## Human verification

1. Are all three children real-landed and independently audited?
2. Was this parent kept `todo` throughout, promoted only after all three are done?

## Touches

- `tasks/gap-prepare-milestone-no-size-aware-routing-A.md`
- `tasks/gap-prepare-milestone-no-size-aware-routing-B.md`
- `tasks/gap-prepare-milestone-no-size-aware-routing-C.md`
