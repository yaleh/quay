---
id: gap-prepare-milestone-no-size-aware-routing
title: prepare-milestone applies uniform full Proposal+Plan synthesis to every
  task regardless of implementation scale, wasting ~50 minutes per small task
  with zero prepared yield across recent samples
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

Add a deterministic size-estimation step after the existing Preflight phase
(DIR-126-B) and before content-agent dispatch. Route each candidate as
**fast-lane** or **full-lane** from two independent dimensions:

```text
codeScale  = expected logical implementation churn
             (L0 = 25*AC_count + 60*expanded_logical_Touches_count)
proofScale = local | integration | real-workflow | cross-generation
```

Fast-lane candidates (one mechanism, ≤~5 logical source/test files, predicted
code churn ≤~800, no migration/concurrency/security-boundary/irreversible-state
or broad runtime-wiring change) receive a lightweight preparation path:

```text
fast-lane:
  one Proposal author + one independent semantic review
  → derived execution manifest (30-100 line equivalent)
  → one PlanCheck
  → prepared receipt

full-lane (today's path, unchanged):
  competing Proposal authors + Adjudicate
  → grounded ProposalReview
  → standalone prose Plan + PlanCheck
  → prepared receipt
```

The **execution manifest** replaces the standalone Plan for fast-lane tasks.
It is a structured, hash-bound artifact containing only: ordered stages and
dependencies; AC-to-stage and AC-to-evidence mappings; bounded touch set;
RED/GREEN and final verification commands; and rollback/recovery requirements.
It does not copy Proposal content or create a second requirement authority.

Size-estimation and routing are deterministic and policy-bound (DIR-124-D
owns tier thresholds and fast-lane eligibility). Verification that a task
qualifies for fast-lane is mechanical, not an agent judgment call.

Dependencies: [[DIR-126-A]] (admission — the insertion point), [[DIR-126-B]]
(preflight — the preceding phase), [[gap-prepare-milestone-task-epoch-budget-reset]]
(epoch budget — fast-lane tasks still count against it, and the epoch boundary
must not be reset by a route change), and [[DIR-124-D]] (execution-policy
registry — sole owner of tier thresholds, fast-lane eligibility, and manifest
schema).

## Plan

N/A — implement after the named dependencies are done. Rollout:

1. Shadow mode: estimate size and route without changing the workflow path;
   record predicted-vs-actual code churn across at least 8 real tasks.
2. Enable fast-lane routing behind an explicit policy flag; verify that two
   real XS/S tasks follow the fast-lane path and produce valid execution
   manifests.
3. After calibration (≥8 shadow + ≥2 enabled samples), make the route
   automatic and remove the flag.

## Finding

The `prepare-milestone` workflow applies one nearly fixed-cost pipeline to
every task: competing ProposalAuthors → Adjudicate → ProposalReview (multiple
rounds) → PlanAuthor → PlanCheck → receipt. Recent measured data show this is
asymmetric in cost for small tasks:

| Period | Tasks | Prepare attempts | Prepare time | Prepared yield |
|---|---|---|---|---|
| M204-M207 | 4 small tasks (~5 AC, ~100-line bodies) | 10 | 202.9m | **0** |
| DIR-126-D/M203 | 1 medium task (24 AC) | 11 | ~232.5m | 0 |

Source: `docs/proposals/quay-milestone-workflow-task-sizing-and-adaptive-execution.md` §2.3.

M205 and M207 began as roughly 100-line task records with five Acceptance
Criteria. Their Prepare cost was asymmetrically high relative to their
implementation scope. In contrast, during the 2026-07-31 fast-mode period,
tasks like `gap-build-phase-null-result-not-gated` and
`gap-touches-orthogonality-symlink-isdirect-mismatch` were prepared and landed
(M208, M209) with NO REFUTATION FOUND in audit while consuming far less
Prepare wall time — effectively a manual fast-lane.

Proposal work consumed 82% of identified Prepare agent time and 84% of output
tokens in the feedback-convergence proposal's reconstruction
(`quay-prepare-execute-feedback-convergence.md` §2.6). The cost is dominated
by author competition, adjudication, and multi-round full-document revision —
all of which are proportional to document size and structural complexity, not
to the implementation risk they are intended to reduce.

The combined Prepare/Execute feedback proposal (§3.1) explicitly defines a
fast-lane contract. The task-sizing proposal (§5) defines the code-scale and
proof-scale tiers. The pipeline-capacity model (§4) shows that a flat 29.1m
Prepare P50 per task makes 0.45-0.65 task/h the realistic serial throughput.
Neither exists as an implemented control path.

## Requested action

### Phase 1 — Size estimation and routing

1. Add a deterministic `estimateTaskSize()` step that computes `L0` from
   acceptance-criteria count and expanded logical Touches after mirror
   collapse (per the sizing proposal's validated `25*AC + 60*Touches`
   formula, §3.1). Missing/unexpandable Touches return
   `scope-estimate-unavailable` and fall back to full-lane; a zero Touches
   count does not imply zero implementation surface.
2. Classify `proofScale` from the task's required evidence surface (source,
   unit, integration, real-workflow, or cross-generation) as declared in ACs
   and the charter.
3. Resolve the S/M/L/XL code-scale tier and fast-lane eligibility against
   DIR-124-D's versioned `ExecutionPolicy` registry. Fast-lane requires:
   exactly one mechanism, ≤~5 logical source/test files, predicted churn
   ≤~800, no migration/concurrency/security-boundary/irreversible-state or
   broad runtime-wiring change. Policy thresholds, not prompt prose, are the
   sole authority.
4. Emit a versioned, hash-bound `PrepareRoutingDecision` with tier, route
   (fast-lane | full-lane), input hashes, and policy reference. Bind it to
   the DIR-124-B RunIdentity and preparation receipt.

### Phase 2 — Fast-lane execution

5. On fast-lane: dispatch one Proposal author (not competing authors +
   adjudication) and one independent semantic reviewer (not multi-round
   ProposalReview). The reviewer uses the same task/charter/repo inputs but a
   fresh context; its finding format and blocking rules are identical to
   full-lane.
6. On fast-lane: generate a structured execution manifest (30-100 line
   equivalent, machine-readable + optional Markdown rendering) containing:
   ordered stages and dependencies; AC-to-stage and AC-to-evidence mappings;
   bounded touch set; RED/GREEN commands; final verification command; and
   rollback/recovery requirements. The manifest references AC and mechanism
   identifiers; it does not copy Proposal content, create a second
   requirement authority, or replace the canonical Proposal.
7. Run one PlanCheck over the manifest. Its rules are the same subset
   applicable to a thin manifest (ordering, evidence modality, touch-set
   consistency, command correctness). A failed PlanCheck allows at most one
   focused manifest revision within the epoch budget.
8. On full-lane: preserve today's complete path unchanged. The route is a
   selection, not a replacement.
9. Every fast-lane generation counts against the task's epoch budget
   ([[gap-prepare-milestone-task-epoch-budget-reset]]). A fast-lane route is
   not permission for unbounded retries.

### Phase 3 — Calibration and rollback

10. Roll out in instrument-only, shadow, enabled-behind-flag, then
    automatic modes. Use DIR-126-D/E telemetry to report: routing decisions
    per task class, fast-lane vs full-lane prepare wall time, manifest
    PlanCheck finding yield, prepared-to-Audit refutation rate by route, and
    any task misrouted (predicted S but actual L).
11. A task routed fast-lane that exceeds its predicted churn by >2× or
    triggers >3 blocking findings in PlanCheck must be reclassified to
    full-lane with a durable reason; the reclassification itself counts as an
    epoch event.
12. DIR-124-D thresholds are recalibrated from at least 10 real post-change
    tasks before automatic routing is enabled.

## Acceptance Criteria

- [ ] Both `prepare-milestone` mirrors call `estimateTaskSize()` after
  Preflight and before any content-agent dispatch on every reachable
  singleton and composite prepare path.
- [ ] Missing/unexpandable Touches return `scope-estimate-unavailable` and
  route to full-lane; zero Touches never implies zero implementation surface.
- [ ] DIR-124-D is the sole executable owner of code-scale tier thresholds,
  fast-lane eligibility, and manifest schema; changing its hash invalidates
  affected routing decisions and receipts.
- [ ] A real task meeting fast-lane criteria dispatches exactly one Proposal
  author, one independent semantic reviewer, one manifest generator, and one
  PlanCheck — no competing authors, adjudication, or multi-round
  ProposalReview.
- [ ] The generated execution manifest is hash-bound, contains all required
  fields, references AC/mechanism identifiers without copying Proposal
  content, and is consumed by execute-milestone's Verify phase.
- [ ] A fast-lane task that triggers >3 blocking PlanCheck findings or
  exceeds 2× predicted churn is reclassified to full-lane with a durable
  reason recorded in the epoch.
- [ ] A full-lane task follows today's unchanged Proposal+Plan path;
  fast-lane is an additional path, not a replacement.
- [ ] Each fast-lane generation counts against the epoch budget; a
  repeated-terminal fuse from the epoch-budget task stops unbounded fast-lane
  retries exactly as it does full-lane.
- [ ] At least 8 shadow-mode tasks and 2 real enabled fast-lane tasks produce
  reproducible routing/manifest/churn calibration data from DIR-126-D/E
  telemetry without private session JSONL.
- [ ] Existing full-lane fixtures, Admission contention, stale-lease recovery,
  exact-terminal reuse, and successful prepared-path behavior remain
  compatible in both mirrors.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on master under human-steered discipline with a versioned policy
  and byte-identical canonical/plugin implementation mirrors.
- [ ] One real XS or S task completes the fast-lane path (author → reviewer →
  manifest → PlanCheck → prepared receipt) and is independently audited;
  its manifest is consumed by a real execute-milestone Verify phase.
- [ ] One real M or L task follows the full-lane path unchanged and is
  independently audited to confirm the fast-lane addition did not alter
  full-lane behavior.
- [ ] The measured fast-lane Prepare wall-time p50 is ≤12 minutes for XS and
  ≤20 minutes for S (target: ≤30% of the comparable full-lane p50); the
  prepared-to-Audit refutation rate for fast-lane tasks does not exceed the
  full-lane rate.
- [ ] A fresh independent audit traces the routing decision, policy
  resolution, fast-lane agent dispatch count, manifest schema, and rollback
  path in production.

## Human verification when exp5 marks this task done

1. Can a task with missing Touches accidentally route fast-lane? It must not.
2. Does the execution manifest copy Proposal content into a second authority?
   It must not.
3. Can a fast-lane task silently retry more times than the epoch budget
   allows? It must not.
4. Does a full-lane task's path change in any observable way? It must not.
5. Is the routing decision traceable to a specific DIR-124-D policy version
   and hash?

## Touches

- `tasks/gap-prepare-milestone-no-size-aware-routing.md`
- `docs/proposals/quay-milestone-workflow-task-sizing-and-adaptive-execution.md`
- `docs/proposals/quay-prepare-execute-feedback-convergence.md`
- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`
- `plugin/scripts/proposal-convergence.ts`
- `experiments/quay-perpetual-stream/scripts/*size-estimat*`
- `plugin/scripts/*size-estimat*`
- `experiments/quay-perpetual-stream/scripts/*execution-manifest*`
- `plugin/scripts/*execution-manifest*`
- `experiments/quay-perpetual-stream/test/*size-estimat*.test.mjs`
- `plugin/test/*size-estimat*.test.mjs`
- `experiments/quay-perpetual-stream/test/*execution-manifest*.test.mjs`
- `plugin/test/*execution-manifest*.test.mjs`

- `docs/plans/M234-gap-size-routing.md`
