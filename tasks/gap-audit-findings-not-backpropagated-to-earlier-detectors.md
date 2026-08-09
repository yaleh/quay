---
id: gap-audit-findings-not-backpropagated-to-earlier-detectors
title: Independently confirmed Execute findings are not classified, calibrated,
  and promoted into earlier Prepare or Verify detectors
status: needs-human
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

- [x] Classification rejects promotion when required evidence does not exist at the proposed
  earlier stage; a runtime-only finding remains Audit/Wiring-Audit scoped.
- [x] One independently confirmed real finding has stable recurrence identity, complete-input
  proof, RED/GREEN fixtures, known-good and ambiguous-valid calibration, and false-positive
  measurements.
- [x] Profile/global activation requires a distinct authorized policy transition; the originating
  observer cannot mutate the policy or authoritative task state.
- [x] A policy activation changes the DIR-124-D hash and invalidates exactly the affected cached
  receipts.
- [ ] A later real milestone is caught at the declared earlier stage with the same recurrence key
  and zero dispatches for downstream work made unnecessary by that failure.
- [x] The later Acceptance/Wiring Audit remains enabled and independently checks for escapes; lower
  cost caused by removing review is not accepted as success.
- [x] Metrics are reproducible from canonical receipts and DIR-126-D/E telemetry without reading
  private Claude session JSONL. Missing value/cost inputs remain explicit unknowns.
- [x] A false-positive or reopened-finding control disables/fails the candidate safely and records
  the policy/receipt consequences.

### AC5 (unchecked — pending a future real milestone)

The AC5 early-catch proof requires a LATER real milestone that exhibits the class to be caught at
PlanCheck with the same recurrence key and zero downstream dispatches. That is a forward-looking
proof this task cannot supply: the mechanism is wired and demonstrated on the real M208 finding
(emits the same recurrence key `ac7-checklist-missing` at PlanCheck), but the "later real milestone"
occurrence is pending. Reported as unknown rather than fabricated (AC7 discipline).

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
- `experiments/quay-perpetual-stream/scripts/finding-backpropagate.ts`
- `plugin/scripts/finding-backpropagate.ts`
- `experiments/quay-perpetual-stream/scripts/execution-policy.ts`
- `plugin/scripts/execution-policy.ts`
- `experiments/quay-perpetual-stream/test/finding-backpropagate.test.mjs`
- `plugin/test/finding-backpropagate.test.mjs`
- `experiments/quay-perpetual-stream/test/execution-policy.test.mjs`
- `plugin/test/execution-policy.test.mjs`
- `docs/proposals/quay-prepare-execute-feedback-convergence.md`

## Test-Files

- `plugin/test/finding-backpropagate.test.mjs`
- `plugin/test/execution-policy.test.mjs`

## Execution record

**Mechanism (landed, both mirrors byte-identical):**

- `finding-backpropagate.ts` — `classifyFinding` (task-specific|profile|global +
  `earliestDetectableStage` + promotion decision; AC1 rejection), `detectAcCoverageCitations`
  (the real M208 PlanCheck detector class, recurrenceKey `ac7-checklist-missing`),
  `proveDetector` (RED/GREEN/ambiguous calibration with measured false-positive rate; AC2),
  `backpropagate` (authorized activation; AC3/AC4), `controlFalsePositive` (AC8),
  `reportBackpropagationMetrics` (AC7 — reads only canonical receipts + DIR-126-D/E telemetry;
  missing cost inputs are explicit unknowns).
- `execution-policy.ts` — the minimal versioned policy-hash + authorized-activation substrate
  DIR-124-D adopts: `createPolicy`, `authorizeActivation` (distinct authorized transition; the
  originating observer can never self-activate), `revokeActivation`, `bindPolicyHash`,
  `invalidateReceiptsForPolicyChange` (exact-affected invalidation, AC4).

**Proof case (real, not synthetic):** `milestones/M208/proposal-ledger.json` entry `55016c0b`
(rootCauseKey `ac7-checklist-missing`) migrates via `migratePrepareLedger` to a FindingEnvelope,
classifies eligible for PlanCheck (complete-input proof = the real task file hash
`tasks/gap-build-phase-null-result-not-gated.md`), and is calibrated against RED/GREEN/ambiguous
corpora. The M192 Build-null runtime finding is the AC1 negative control (rejected for promotion to
PlanCheck because `buildRuntimeResult` first exists at Build).

**Invoke evidence (scoped run, exit 0):**

```text
$ bash scripts/test.sh --for-task gap-audit-findings-not-backpropagated-to-earlier-detectors
PASS: every test file uses node:test ... new files declare @test-group.
PASS: all 44 violation(s) are baselined in plugin/test-isolation-violations.txt ...
task-contract-check: no violations.
PASS: no NEW stale strategic doc beyond the KNOWN_STALE baseline
ℹ pass 36
ℹ fail 0
ℹ duration_ms 459.384987
```

Real-finding classification CLI output (M208 finding `55016c0b`):

```text
MIGRATED finding: 55016c0b | ac7-checklist-missing
CLASSIFY: {"earliestDetectableStage":"PlanCheck","generalization":"profile","promotionAllowed":true,
  "detectorCandidate":{"detectorId":"det-ac-coverage-citations","recurrenceKey":"ac7-checklist-missing",
  "rule":"detectAcCoverageCitations","stage":"PlanCheck"}}
CALIBRATION: {"ok":true,"redHitRate":1,"falsePositiveRate":0,"ambiguousValidRate":1}
BACKPROP audit-attempt: false | authorizer-role-not-authorized: "Audit" cannot activate ...
BACKPROP authorized: true | back-propagated ac7-checklist-missing to PlanCheck; 1 affected receipt(s) invalidated
METRICS: {"total":2,"generalizable":1,"promoted":1,"backPropagationRate":1,
  "unknownFields":["agent-minutes (contentAgentMs) absent from canonical telemetry",
  "token delta absent from canonical telemetry"]}
```

**Re-verification (2026-08-07, inner-loop re-dispatch):** fresh scoped run in worktree
`/home/yale/work/quay-worktrees/audit-findings-not-backpropagated-to-earlier-detectors`
(HEAD b423f413, which already carries the 6740d4fc implementation) — `bash scripts/test.sh
--for-task gap-audit-findings-not-backpropagated-to-earlier-detectors` exits 0:

```text
✔ mirror parity: finding-backpropagate.ts + execution-policy.ts byte-identical across experiments/plugin
✔ AC2: the REAL M208 finding migrates via the canonical ledger adapter and classifies eligible for PlanCheck
✔ AC1: runtime-only finding (M192 Build-null class) is REJECTED for promotion to PlanCheck
✔ AC1: a finding with NO material input hashes (incomplete-input proof) is never promoted
✔ AC2: RED/GREEN/ambiguous calibration passes with redHitRate=1 and falsePositiveRate=0
✔ AC3: the originating observer cannot activate its own candidate; a policy-owner can
✔ AC4: policy activation changes the policy hash and invalidates exactly the affected cached receipts
✔ AC6: back-propagation is read-only on task/audit state — the later Acceptance/Wiring Audit stays enabled
✔ AC7: metrics are reproducible from canonical receipts + DIR-126-D/E telemetry; missing cost inputs are explicit unknowns
✔ AC8: a false-positive/reopened-finding control disables the candidate safely and records policy+receipt consequences
PASS: every test file uses node:test ... new files declare @test-group.
PASS: all 44 violation(s) are baselined in plugin/test-isolation-violations.txt
task-contract-check: no violations.
PASS: no NEW stale strategic doc beyond the KNOWN_STALE baseline
ℹ tests 36
ℹ pass 36
ℹ fail 0
ℹ duration_ms 3467.003453
```

Real-finding proof case re-reproduced from the checked-in canonical sources (exit 0):

```text
MIGRATED finding: 55016c0b | ac7-checklist-missing
CLASSIFY: {"findingId":"55016c0b","recurrenceKey":"ac7-checklist-missing","observerStage":"Receipt",
  "generalization":"profile","earliestDetectableStage":"PlanCheck","promotionAllowed":true,
  "detectorCandidate":{"detectorId":"det-ac-coverage-citations","recurrenceKey":"ac7-checklist-missing",
  "rule":"detectAcCoverageCitations","stage":"PlanCheck"}}
CALIBRATION: {"ok":true,"redHitRate":1,"falsePositiveRate":0,"ambiguousValidRate":1}
BACKPROP audit-attempt: false | authorizer-role-not-authorized: "Audit" cannot activate a detector (originating observers cannot self-authorize)
BACKPROP authorized: true | back-propagated ac7-checklist-missing to PlanCheck; 1 affected receipt(s) invalidated
METRICS: {"schemaVersion":"1","totalFindings":2,"generalizableFindings":1,"promotedFindings":1,
  "backPropagationRate":1,"recurringFindings":1,
  "recurrenceWasteAgentMinutes":{"value":null,"unknown":true},"tokenDelta":{"value":null,"unknown":true},
  "unknownFields":["agent-minutes (contentAgentMs) absent from canonical telemetry",
  "token delta absent from canonical telemetry"]}
```

**AC status:** AC1, AC2, AC3, AC4, AC6, AC7, AC8 satisfied with mechanical tests (36 scoped tests,
0 fail). AC5 unchecked (requires a future real milestone). DoD unchecked per fast-mode discipline
(DoD1 requires deps DIR-124-D / DIR-118 `todo` + a future milestone; DoD2's checked-in evidence is
present and reproducible but agent-minutes/token cost inputs are explicit unknowns from canonical
telemetry; DoD3 requires the outer's fresh independent audit).
Dependency note: DIR-124-D (full execution-policy registry) and DIR-118 (post-Land observer) are
`todo`; this task supplies the versioned policy-hash + authorized-activation substrate that
DIR-124-D adopts, and wires the mechanism without depending on the unlanded post-Land observer.
