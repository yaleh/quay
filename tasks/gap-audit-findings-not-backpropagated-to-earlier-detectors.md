---
id: gap-audit-findings-not-backpropagated-to-earlier-detectors
title: Independently confirmed Execute findings are not classified, calibrated,
  and promoted into earlier Prepare or Verify detectors
status: todo
labels:
  - gap
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

Close the Prepare/Execute feedback loop by turning eligible, independently confirmed downstream
findings into calibrated earlier detectors. Promotion is conservative:

```text
task-specific finding
  -> confirmed recurrence/detector candidate
  -> RED/GREEN fixture and false-positive calibration
  -> explicitly authorized profile/global policy
  -> later real early-stage catch
```

Not every Audit or Wiring-Audit finding should move earlier. The finding's required facts must
exist at its declared `earliestDetectableStage`; runtime reachability defects remain downstream.
This task consumes DIR-124-B's canonical FindingEnvelope and DIR-124-D's policy authorization. It
does not create another finding store or let an auditor activate the rule it proposes.

Dependencies: [[DIR-126-D]], [[DIR-124-B]], [[DIR-124-D]], and [[DIR-118]]. DIR-126-E's real
Prepare-cost report should be available for the efficiency comparison, but absence of an
end-to-end value estimate must be reported as unknown rather than fabricated.

## Plan

N/A — execute only after the named envelope, policy, telemetry, and post-Land observer mechanisms
are real-landed. Select one already independently confirmed finding whose complete inputs existed
no later than PlanCheck/Verify; do not manufacture a convenient synthetic success case.

## Finding

Prepare currently refines Proposal and Plan while Execute Audit/Gate/Wiring Audit discover
implementation and reachability failures. Stable codes and ledgers retain some local history, but
there is no production mechanism that classifies a downstream finding's earliest detectable
stage, proves a detector against good/bad corpora, authorizes its policy scope, and then measures a
later real catch. The same defect class can therefore consume fresh semantic review repeatedly.

The geometric feedback model tolerates errors only when later observations shrink future search
space. Without back-propagation, Execute remains a terminal inspector rather than a learning
feedback surface.

## Requested action

1. Add a deterministic classification/review command consuming canonical FindingEnvelopes and
   emitting `task-specific|profile|global`, `earliestDetectableStage`, recurrence evidence, and an
   optional detector candidate.
2. Require independent confirmation, stable recurrence key/reason code, complete-input proof,
   RED/GREEN fixtures, known-good/ambiguous corpora, and measured false-positive behavior before a
   detector can request profile/global activation.
3. Route activation through DIR-124-D's versioned authorization and policy hash. The proposing
   Audit/Wiring Audit is read-only and cannot approve or activate its own candidate.
4. Wire one eligible detector into the earliest stage where all inputs exist, preserving later
   independent review as a control rather than deleting it.
5. Prove the detector on a later real milestone: it catches the recurrence earlier, emits the same
   recurrence identity, spends less downstream agent work, and does not reject the calibrated
   valid/ambiguous corpus.
6. Report Audit back-propagation rate, recurrence waste before/after, agent-minute/token change,
   prepared-to-Audit refutation behavior, and any unknown value fields from checked-in receipts and
   telemetry.

## Acceptance Criteria

- [ ] Classification rejects promotion when required evidence does not exist at the proposed
  earlier stage; a runtime-only finding remains Audit/Wiring-Audit scoped.
- [ ] One independently confirmed real finding has stable recurrence identity, complete-input
  proof, RED/GREEN fixtures, known-good and ambiguous-valid calibration, and false-positive
  measurements.
- [ ] Profile/global activation requires a distinct authorized policy transition; the originating
  observer cannot mutate the policy or authoritative task state.
- [ ] A policy activation changes the DIR-124-D hash and invalidates exactly the affected cached
  receipts.
- [ ] A later real milestone is caught at the declared earlier stage with the same recurrence key
  and zero dispatches for downstream work made unnecessary by that failure.
- [ ] The later Acceptance/Wiring Audit remains enabled and independently checks for escapes; lower
  cost caused by removing review is not accepted as success.
- [ ] Metrics are reproducible from canonical receipts and DIR-126-D/E telemetry without reading
  private Claude session JSONL. Missing value/cost inputs remain explicit unknowns.
- [ ] A false-positive or reopened-finding control disables/fails the candidate safely and records
  the policy/receipt consequences.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] All named dependencies are done and one real later milestone supplies the early-catch proof.
- [ ] Checked-in evidence reports before/after recurrence waste, agent-minutes/tokens, coverage, and
  escape behavior without using LOC or duration as an individual productivity score.
- [ ] A fresh independent audit confirms the promoted detector is earlier, calibrated, authorized,
  non-bypassable for its profile, and did not weaken later review.

## Human verification when exp5 marks this task done

1. Did a real downstream finding measurably reduce later search, or was only a fixture added?
2. Were all detector inputs actually available at the promoted stage?
3. Can an observer promote its own finding or silently weaken independent review?

## Touches

- `tasks/gap-audit-findings-not-backpropagated-to-earlier-detectors.md`
- `experiments/quay-perpetual-stream/scripts/*finding*`
- `plugin/scripts/*finding*`
- `experiments/quay-perpetual-stream/scripts/*execution-policy*`
- `plugin/scripts/*execution-policy*`
- `experiments/quay-perpetual-stream/test/*finding*.test.mjs`
- `plugin/test/*finding*.test.mjs`
- `docs/proposals/quay-prepare-execute-feedback-convergence.md`
