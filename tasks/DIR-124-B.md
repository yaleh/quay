---
id: DIR-124-B
title: Single-source milestone RunIdentity, stage journal, hash-bound receipts,
  Verify cache, and explicit resume
status: todo
labels:
  - directive
  - human-steered
parent: DIR-124
children: []
extra:
  dirStatus: applied
  schema: v1
---
**type:** execution

## Proposal

Establish the canonical information-transfer substrate between milestone stages. Define one
`RunIdentity`, one append-only journal, and one hash-bound `StageReceiptEnvelope`; persist Verify
cache entries through that store; and make retry/resume an explicit validation-driven operation.

This child implements C2 of the crystallization proposal. It consumes [[DIR-124-A]] observability,
[[DIR-123]] physical isolation, and the resolved
`gap-build-phase-iteration-evidence-path-not-single-sourced`. It deliberately does not implement
[[DIR-118]]'s post-Land Wiring Audit or task-promotion policy.

## Plan

Full checked milestone Plan: `docs/plans/M236-dir-124-b.md` (M236, base `65f414c4`). Covers all 11
AC items across 8 ordered stages (RED contracts → implementation → GREEN → mirrors + canonical glob
→ workflow wiring → wiring GREEN → real post-Land proof). The Lifecycle-feasibility section names
the iteration-0 Audit-REFUTED-by-construction terminal (DoD 1–4 and the real halves of AC4/AC5/AC7
are post-Land evidence): Stages 1–7 land human-steered, `done` is reached only via the post-Land
Stage-8 re-promote.

## Finding

The live Verify phase accepts `cacheFingerprints` and `priorVerifyCache`, returns
`verifyCacheUpdates`, and relies on its caller to persist them. Observed M185–M189 calls did not
close that loop. Other stages transfer evidence through prompt output, mutable files, staging
state, and task/dashboard text without a common binding to base commit, candidate commit, workflow
source, inputs, or runtime generation.

Consequently, a result can look reusable while proving another filesystem state or materialized
workflow. Resume behavior is prompt/cache folklore rather than a durable transition, and the
known `Workflow({name})` stale-materialization defect cannot be rejected by a stage receipt.

## Requested action

1. Define canonical typed `RunIdentity`, `FindingEnvelope`, `StageEvent`,
   `StageReceiptEnvelope`, and `ReceiptValidationResult` contracts shared by singleton and
   composite execution.
   `FindingEnvelope` includes occurrence identity, stable `recurrenceKey`, observer/earliest
   detectable stage, subsystem/claim reference, severity/blocking, evidence references, material
   input hashes, first/last generation, disposition/resolution, and
   `task-specific|profile|global` generalization.
2. Bind identity/receipts to run ID, candidate ID, task IDs, attempt, base commit, candidate commit,
   workflow source path/hash/commit, runtime generation, and task/charter/Plan/material input hashes.
3. Store stage events and receipts append-only under the canonical milestone root, with atomic write
   and schema/version validation.
4. Move Verify cache persistence into this store. Cache lookup must validate the exact check input,
   base/candidate state, workflow source, and runtime generation before reuse.
5. Implement explicit resume: determine the earliest invalid/incomplete stage, reuse only validated
   prior receipts, increment attempt identity, and record why each earlier stage was reused or
   invalidated.
6. Add fail-closed validation for wrong candidate/base/Plan/workflow hash/runtime generation,
   tampered receipt, missing artifact, and candidate commit movement.
7. Provide a migration/compatibility adapter for DIR-124-A diagnostic events; do not retain two
   authoritative journal schemas.
8. Expose extension fields needed later by DIR-118, but do not add `landed-awaiting-wiring`,
   post-Land audit dispatch, or `done`-promotion enforcement.
9. Add a one-way compatibility adapter for DIR-126-D Prepare telemetry and the existing Prepare
   finding ledger. Preserve their hashes and provenance while making this task's envelopes the
   sole cross-workflow receipt/finding contract.
10. Allow a receipt to hash-reference a Build evidence manifest or other bounded evidence index.
    Receipts must not copy authoritative task, Proposal, charter, or Plan content.

## Acceptance Criteria

- [ ] Singleton and composite calls use the same canonical RunIdentity and receipt envelope.
- [ ] Prepare review, PlanCheck, Acceptance Audit, Gate, and later Wiring Audit findings validate
  against one versioned FindingEnvelope; recurrence does not permit reuse when material input
  hashes differ.
- [ ] Every receipt is mechanically bound to base/candidate commits, workflow source hash/commit,
  runtime generation, and material input hashes.
- [ ] Stage journal and receipts survive process/session restart and reject partial/torn writes.
- [ ] A second unchanged run reuses valid Verify receipts from the store; changing only one check's
  material input reruns only that check.
- [ ] Wrong base, wrong candidate, modified Plan, stale named-workflow materialization, wrong runtime
  generation, missing artifact, moved candidate commit, and tampered receipt each fail closed in
  RED/GREEN tests.
- [ ] Explicit resume records the earliest invalid stage and never silently reuses a receipt merely
  because prompt/label strings match.
- [ ] DIR-124-A events have one migration path into the durable journal; no dual authoritative
  event format remains.
- [ ] DIR-126-D telemetry and existing Prepare-ledger fixtures migrate one way into the canonical
  contracts with preserved source hashes and no dual-write or reverse dependency.
- [ ] A receipt can validate a hash-bound Build evidence-manifest reference, while a fixture that
  embeds copied task/Plan requirements in the receipt is rejected as a duplicate authority.
- [ ] No DIR-118 lifecycle state or post-Land Wiring Audit behavior is introduced.

## Definition of Done

Standard exp5 DoD clauses apply.

- [ ] Landed and mirrored through the plugin packaging path with canonical tests green.
- [ ] One real milestone is interrupted after at least one stage and successfully resumes from
  validated persisted receipts in a later process/session.
- [ ] One real stale-receipt case is rejected and restarts from the correct stage.
- [ ] Independent audit checks receipt bytes/hashes and real caller persistence, not just type
  declarations or fixtures.

## Human verification when exp5 marks this DIR done

1. Can a receipt prove exactly which candidate and installed workflow generation produced it?
2. Does Verify cache survive a real caller/session boundary?
3. Can resume explain mechanically why each stage was reused or rerun?
4. Is DIR-118 still responsible for wiring-required lifecycle semantics?

## Touches

- `experiments/quay-perpetual-stream/scripts/*run-identity*`
- `experiments/quay-perpetual-stream/scripts/*stage-receipt*`
- `experiments/quay-perpetual-stream/scripts/*workflow-journal*`
- `experiments/quay-perpetual-stream/scripts/*workflow-resume*`
- `experiments/quay-perpetual-stream/test/*stage-receipt*`
- `experiments/quay-perpetual-stream/test/*workflow-resume*`
- `plugin/scripts/*run-identity*`
- `plugin/scripts/*stage-receipt*`
- `plugin/scripts/*workflow-journal*`
- `plugin/scripts/*workflow-resume*`
- `plugin/test/*stage-receipt*`
- `plugin/test/*workflow-resume*`
- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`

- `docs/plans/M236-dir-124-b.md`