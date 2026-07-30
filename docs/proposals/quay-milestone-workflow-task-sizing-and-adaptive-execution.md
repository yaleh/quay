# Proposal — Size-aware milestone preparation and adaptive workflow execution

- **Status:** proposal / measured policy recommendation
- **Date:** 2026-07-30
- **Evidence cutoff:** commit `159067f` at 2026-07-30T14:47:34Z
- **Scope:** estimate task size before or early in `prepare-milestone`, select a
  workflow shape and review budget proportional to that size, and stop repeated
  preparation attempts before their fixed cost overwhelms expected delivery
  value.
- **Related:**
  [`quay-milestone-workflow-throughput-capacity-model.md`](./quay-milestone-workflow-throughput-capacity-model.md)
  supplies the execution baseline. ·
  [`quay-prepare-execute-feedback-convergence.md`](./quay-prepare-execute-feedback-convergence.md)
  defines the broader Prepare/Execute feedback model. ·
  [`DIR-125`](../../tasks/DIR-125.md) bounds within-generation ProposalReview. ·
  [`split-decision finality`](../../tasks/gap-prepare-milestone-split-decision-no-finality.md),
  [`cross-generation review continuation`](../../tasks/gap-prepare-milestone-cross-generation-review-state-reset.md),
  and [`task-epoch budget/fuse`](../../tasks/gap-prepare-milestone-task-epoch-budget-reset.md)
  track the principal missing controls identified by this analysis.

## 1. Decision summary

Quay should stop applying one nearly fixed-cost milestone workflow to every
task. Admission should first estimate two independent dimensions:

```text
codeScale  = expected logical implementation change
proofScale = cost of integration, real-workflow, and cross-generation proof
```

`codeScale` should determine task splitting, Proposal/Plan depth, author count,
and whether several small tasks should be packed into a safe composite.
`proofScale` should determine Audit, negative-control, and real-E2E budget. A
small proof-heavy task needs strong evidence, not a repeatedly regenerated
large Proposal.

The initial code-size estimator is:

```text
L0 = 25 * acceptanceCriteriaCount + 60 * expandedLogicalTouchesCount
```

It is valid only after `## Touches` is complete, expanded, and canonical/plugin
mirrors have been collapsed into logical paths. Once a Plan exists, refine it:

```text
normal task:          L1 = max(L0, 1.4 * planEstimatedLOC)
large fixture matrix: L1 = max(L0, 2.0..2.2 * planEstimatedLOC)
```

Preparation must then be bounded by task/charter epoch. One full synthesis is
allowed per stable scope; later work is finding-ledger-driven delta revision.
Two repeated equivalent terminals force a split or human decision rather than
another full dispatch.

## 2. Why a size-aware policy is needed

The historical M185-M189 baseline was 58.8 minutes per workflow attempt and
70.5 work-normalized minutes per delivered task. Build and Audit dominated;
Verify and Gate were comparatively small. Adding a serial 15-25 minute Prepare
already threatened to reduce throughput from about 0.85 task/hour to
0.63-0.71 task/hour.

Subsequent work showed a more severe failure mode: Prepare is not merely an
extra bounded stage. It can become an unbounded restart loop.

### 2.1 DIR-120 / M192

The first ten ProposalReview runs produced this finding sequence:

```text
8 -> 2 -> 1 -> 1 -> 1 -> 2 -> 2 -> 1 -> 2 -> 1
```

They consumed about 195 workflow-active minutes and 226 wall-clock minutes
without reaching PlanAuthor. Preparation rewrote 6,191 task/charter lines to
produce an approximately 826-line retained result, a 7.5x churn ratio. The
findings were often real, including the eventual DIR-120-B split, but the
workflow repeatedly paid for two new authors, full adjudication, and review of
a moving target.

### 2.2 DIR-126-D / M203

Eleven attempts consisted of one Admission rejection, one Preflight rejection,
and nine `split-recommended` terminals. They consumed about 232.5 workflow
minutes, 4.59 observable agent-hours including follow-up revisions, and 9.53M
aggregate workflow/subagent tokens, while producing no `prepared` result.
Human adjudication eventually froze the task at two mechanisms and allowed the
existing Plan to proceed. Repeated full review had not made the mechanism count
stable.

### 2.3 M204-M207 at the evidence cutoff

The new per-attempt telemetry recorded:

| Milestone | Attempts | Prepare time | Terminal distribution |
|---|---:|---:|---|
| M204 / DIR-126-E | 4 | 54.3m | 3 split, 1 preflight rejection |
| M205 / wiring checker gap | 2 | 40.9m | 2 split |
| M206 / split finality | 2 | 53.1m | 2 split |
| M207 / timing recurrence | 2 | 54.6m | 1 wiring failure, 1 split |
| **Total** | **10** | **202.9m** | **0 prepared** |

This is 3.45 historical average Execute attempts of effort before any of the
four tasks entered Build. M205 and M207 began as roughly 100-line task records
with five Acceptance Criteria, demonstrating that fixed full-synthesis cost is
especially harmful for small tasks.

## 3. Three-day validation data

The validation window is 2026-07-27T00:00:00Z through the evidence cutoff. Ten
landed milestones with attributable Build commits were inspected: M192, M193,
M194, M195, M197, M198, and M200-M203. M191 and other composites whose code
could not be assigned cleanly to one task were excluded from the estimator
sample rather than guessed.

Actual size is canonical implementation churn: added plus deleted production,
test, fixture, workflow, and executable-configuration lines. Plugin mirrors and
task, Plan, audit, and evidence prose are excluded.

### 3.1 Estimator validation with complete Touches

| Milestone | AC | Touches | `L0` | Actual | Absolute error |
|---|---:|---:|---:|---:|---:|
| M193 / DIR-125 | 11 | 12 | 995 | 1,073 | 7% |
| M198 / DIR-119-D1 | 18 | 6 | 810 | 920 | 12% |
| M200 / DIR-126-A | 15 | 7 | 795 | 649 | 22% |
| M201 / DIR-126-B | 24 | 9 | 1,140 | 1,350 | 16% |
| M202 / DIR-126-C | 27 | 6 | 1,035 | 812 | 27% |
| M203 / DIR-126-D | 24 | 12 | 1,320 | 1,219 | 8% |

The mean absolute percentage error is 15.5%. Four of six samples land in the
exact proposed size tier; the remaining two miss by one adjacent tier. No
sample misses by two tiers. This is useful for routing, but the sample is too
small and homogeneous to claim a general predictive model.

### 3.2 Missing Touches invalidates the estimate

| Milestone | AC-only estimate | Actual | Absolute error |
|---|---:|---:|---:|
| M192 / DIR-120 | 275 | 694 | 60% |
| M194 / DIR-120-B | 200 | 329 | 39% |
| M195 / DIR-117-B | 125 | 357 | 65% |
| M197 / cross-generation reuse gap | 250 | 138 | 81% |

Mean absolute percentage error rises to 61.4%. Missing Touches therefore must
not be interpreted as zero touched files. Admission should return a typed
`scope-estimate-unavailable` result and request a conservative Touches set.

### 3.3 Plan estimate correction

| Milestone | Plan estimate | Actual | Actual / Plan |
|---|---:|---:|---:|
| M200 | about 590 | 649 | 1.10x |
| M201 | 612 | 1,350 | 2.21x |
| M202 | 615 | 812 | 1.32x |
| M203 | 865 | 1,219 | 1.41x |

The median multiplier is about 1.36x, supporting a default 1.4x correction.
M201 validates the separate 2.0-2.2x correction for a detector with a broad
good/bad/ambiguous fixture matrix and audit-driven calibration fixes.

## 4. Two-dimensional sizing contract

### 4.1 Code scale

| Tier | Estimated logical churn | Default treatment |
|---|---:|---|
| XS | <=200 | mechanical checks, one implementer, focused audit |
| S | 201-500 | one author, one grounded review, at most one delta review |
| M | 501-900 | one full synthesis, at most two delta reviews |
| L | 901-1,400 | full synthesis, early split checkpoint, at most three delta reviews |
| XL | >1,400 | split or stage decomposition by default |

The XL boundary is a hypothesis: no completed task in the three-day estimator
sample exceeded 1,400 canonical churn lines. It must remain configurable until
more real tasks validate it.

### 4.2 Proof scale

| Tier | Required proof surface | Typical examples |
|---|---|---|
| local | deterministic unit/selftest | parser or local helper change |
| integration | multiple real modules or workflow boundary | Prepared gate wiring |
| real-workflow | real dispatch, negative control, journal or process evidence | M195/M197 |
| cross-generation | later runtime generation or post-Land proof | DIR-117-B-style proof |

Proof scale raises Audit/evidence budget, not Proposal author count. M197 changed
only 138 canonical lines but required real workflow journal evidence. M194
changed 329 lines and completed on a lightweight path because its mechanism and
proof surface were local. Treating both as the same large preparation problem
would waste work without improving evidence.

### 4.3 Uncertainty markers

Before PlanAuthor, attach a wider estimate interval when the task introduces:

- a new lock, lease, persistence schema, or recovery state;
- a new parser/detector with combinatorial fixtures;
- a real-workflow or cross-generation proof obligation;
- more than two independently landable mechanisms;
- globbed Touches that cannot yet be enumerated; or
- external behavior whose current production wiring is unconfirmed.

Use `0.75L0..1.35L0` for ordinary tasks and `0.80L0..1.70L0` for novel
control-plane tasks. These are routing intervals, not delivery promises.

## 5. Workflow selection policy

### 5.1 XS and S

Run deterministic schema, Touches, grounding, and wiring checks first. Use one
author or the implementer directly, one focused review, and no repeated full
synthesis. Pack independent, capacity-valid small tasks into a composite so
they share Verify/Audit/Land fixed costs.

The seven-task M-DIR119-C-CANARY changed about 485 canonical lines and landed
seven leaves in about 73 minutes. That validates the throughput potential, but
its later audit concerns also show that composites still require production
wiring and atomicity checks; packing is not permission to weaken Audit.

### 5.2 M

Allow one full synthesis and at most two finding-ledger-driven delta reviews.
The default soft Prepare budget is 20-25 minutes and the decision ceiling is 45
minutes. At the ceiling, choose focused continuation, split, or human decision.

### 5.3 L and high-risk

Allow one full synthesis and at most three delta reviews. Run a split checkpoint
after the first grounded review. The soft budget is 30-45 minutes and the
decision ceiling is 60-75 minutes. A proof-heavy task may receive additional
Audit time without receiving additional full Proposal generations.

### 5.4 XL or multiple independent mechanisms

Default to ordered children, an atomic composite of small cohesive leaves, or
stage decomposition. A single large milestone requires an explicit COMMIT
decision explaining why its mechanisms cannot be independently delivered and
how its critical path remains bounded.

## 6. Early recalibration and stopping rules

The first grounded review is the mandatory recalibration point. Record:

```text
scopeDrift       = discoveredLogicalTouches / declaredLogicalTouches
findingYield     = newBlockingFindings / reviewMinutes
repeatRate       = repeatedRecurrenceKeys / allFindings
proposalChurn    = cumulativeRewrittenLines / retainedProposalLines
mechanismCount   = typed, independently-shippable mechanisms
```

Apply these rules:

1. If actual Touches exceed declared Touches by more than 25%, recompute size.
2. With 0-2 blockers, proceed to Plan.
3. With 3-5 blockers, allow one focused revision, not a new full synthesis.
4. With more than five blockers, enter an immediate split checkpoint.
5. If one subsystem accumulates at least three independent blockers, split or
   obtain an explicit COMMIT ruling.
6. If `mechanismCount > 2`, require split/COMMIT before another review.
7. If Proposal churn exceeds 2.5x, prohibit full regeneration.
8. Two equivalent terminal fingerprints in one task/charter epoch produce
   `human-decision-required`.
9. Ordinary Proposal edits do not reset the epoch or its cumulative budget.

DIR-120 validates the more-than-five rule: its first review returned eight
findings, but split did not occur until several full restarts later. DIR-126-D
validates terminal finality: repeated reviewers returned unstable mechanism
counts until a human froze the two-mechanism interpretation. M204-M206 each
reached the proposed repeated-terminal fuse at the evidence cutoff.

## 7. Economic stopping criterion

An additional review is justified only when its expected avoided rework exceeds
its cost:

```text
p(blocker prevented) * expected retry cost > next review cost
```

The historical retry reference is approximately 56 minutes of Build/Audit
work. A 20-minute review therefore needs more than about a 36% probability of
preventing one such retry. This formula is a decision aid, not a calibrated
probability model. DIR-120 supports its direction: the first two rounds averaged
five findings per round, while the next eight averaged about 1.4, despite
continuing to pay full-synthesis cost.

Safety invariants and independent Audit are never optional merely because the
formula predicts low short-term value. The criterion chooses between full
review, focused delta, split, and human decision; it does not authorize silent
acceptance.

## 8. Required telemetry and acceptance metrics

Each task/charter epoch should record:

- `acceptanceCriteriaCount`, expanded logical Touches, `L0`, `L1`, and interval;
- `codeScale`, `proofScale`, uncertainty markers, and routing decision;
- full-synthesis and delta-review counts;
- terminal fingerprint and recurrence key;
- review/agent/wall minutes and aggregate tokens;
- Proposal/Plan churn and retained size;
- first-review and post-round-two blocker yield;
- prepared-to-Build conversion and final canonical/physical churn;
- Build/Audit retry count and escaped high-severity findings; and
- candidate/hour and leaf-task/hour, reported separately.

Initial operational targets are:

| Metric | Target |
|---|---:|
| full syntheses per stable task/charter epoch | 1 |
| delta review rounds, p50 / p90 | <=1 / <=3 |
| Prepare wall time, p50 / p90 | <=25m / <=60m |
| Prepare/Execute ratio, ordinary / high-risk | <=35% / <=60% |
| Proposal churn ratio | <=2.5x |
| attempts per delivered task | <=1.10 |

Efficiency reports must also show verified-capability coverage and escaped
defect severity. Lower time caused by deleting checks is a regression, not an
optimization.

## 9. Rollout

1. Add a read-only estimator to Admission and report its inputs and confidence.
2. Make missing/unexpandable Touches fail with `scope-estimate-unavailable`.
3. Observe at least ten additional landed tasks without changing routing;
   compare predicted and actual canonical churn by task class.
4. Enable XS/S lightweight routing behind an explicit policy flag.
5. Enable task-epoch budgets and repeated-terminal fuse.
6. Enable typed mechanism inventory and hash-bound COMMIT/SPLIT finality.
7. Enable cross-generation ledger continuation so a fuse has a safe delta path.
8. Recalibrate coefficients and tier boundaries separately for application,
   methodology, parser/detector, and control-plane classes.

No coefficient should become a correctness gate until the shadow sample shows
acceptable calibration. The immediate hard gates are limited to having enough
scope information to estimate, preserving required safety checks, and stopping
known repeated-terminal loops.

## 10. Validation status and limitations

| Claim | Status at cutoff |
|---|---|
| `25*AC + 60*Touches` with complete Touches | supported; 15.5% MAPE, n=6 |
| AC-only estimation when Touches are absent | refuted; 61.4% MAPE, n=4 |
| default 1.4x Plan correction | supported; median 1.36x, n=4 |
| 2.0-2.2x fixture-matrix correction | supported by M201; needs more samples |
| bounded 25/45/75m Prepare decisions | strongly supported as a loop detector |
| repeated-terminal fuse after two equivalents | strongly supported |
| first-review `>5` split checkpoint | supported by DIR-120 |
| XS/S lightweight or composite execution | supported, with audit caveats |
| default split above 1,400 logical lines | unvalidated in this window |
| probability-based economic stop | directionally supported, not causal proof |

The data are observational, workload-mixed, and partially reconstructed from
Git and session telemetry. A malformed Claude session record prevented one
cross-provider bulk query; figures used here were recovered from targeted
session analyses and checked against durable Git, preparation receipts, and
per-attempt telemetry. This proposal therefore recommends a shadow-calibrated
policy, not a fixed universal productivity formula.
