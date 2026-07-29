# M199 — DIR-126: make prepare-milestone flow-efficient (single-flight admission, deterministic
preflight, generation-aware resume, phase telemetry, capacity calibration)

**Task:** DIR-126 · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.4 K · **type:** execution · **highRisk:** yes

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). DIR-126's own Finding (a read-only
audit of git/workflow-journal history) recorded 17 non-fixture `prepare-milestone` calls across
M192/M195/M196/M198 with only 1 clean `prepared` terminal outcome, ~118 workflow-minutes on M195
alone (57 of them PlanCheck, vs. the current 15-25 minute capacity assumption), ~54 duplicate
workflow-minutes from two overlapping M196 generations, and a 2.09:1 ratio of process-artifact
lines to code+test lines across the sampled window. M198 (this repo's own immediately-prior
milestone) independently reproduced the identical defect class this same session: 3 fresh
`prepare-milestone` generations each hit `needs-human` before a human-steered fix landed, one of
them for a genuine regex false-positive in the shared `wiring-coverage-check.ts` checker. DIR-126
treats this as a first-class control-plane invariant, not a reporting afterthought.

## Why highRisk

This milestone's declared `## Touches` includes `.claude/workflows/prepare-milestone.js` (both
mirrors) — the same active, every-milestone-dispatches-through control-plane file M196 flagged as
highRisk for an analogous reason — plus `proposal-convergence.ts`/`milestone-preparation-check.ts`
(the receipt/ledger integrity engine) and `OUTER-LOOP.md`. A defect here would degrade every
future milestone's own Prepare phase, not just this one. N=3 proposal authors and the extra
delta-review round are warranted.

## Prepared-gate note

Dispatched under the M195/DIR-117-B enforced-by-default Prepared gate: carries a real
`prepare-milestone.js` receipt consumed by its `execute-milestone.js` dispatch.

## Mandatory SPLIT-OR-COMMIT note

The task's own Proposal REQUIRES a DIR-026 SPLIT-OR-COMMIT analysis across its 5 named mechanisms
(single-flight admission, deterministic preflight, generation-aware resume, phase telemetry,
capacity calibration) BEFORE any implementation Plan is authored, defaulting to a split into
ordered children if more than two require separate production ownership or proof surfaces (the
same 2-mechanism threshold `checkSplitRecommendation()` already enforces mechanically). This
charter's own `prepare-milestone` dispatch is expected to surface that determination via a real
ProposalReview run, not a human guess — if `split-recommended` fires, this milestone's own scope
is exactly that analysis + the ordered child split (mirroring the DIR-119-D precedent, M196), and
the first ordered child gets its own later charter.

## Scope

Per `tasks/DIR-126.md`'s own Requested action / Acceptance Criteria / Definition of Done — not
duplicated here. In short: (1) run and record the mandatory split-or-commit analysis first; (2) if
split, formal ordered children preserving `extra.rank: 0`/`priority:urgent`; (3) single-flight
admission for `(workspace, taskId)` with fail-closed contention output and evidence-based stale-
owner recovery; (4) deterministic mechanical preflight (stable codes + fixtures) for the recurring
M192/M195/M196/M198 failure classes, run before any LLM author/reviewer dispatch; (5) generation-
aware resume replacing the manually-supplied `resumeFromAdjudicatedProposal` boolean with a
fail-closed, hash/provenance-derived decision; (6) per-phase/generation telemetry, hash-bound into
the receipt/ledger, queryable without parsing raw Claude Code session JSONL; (7) recalibrated
capacity report (P50/P85 Prepare time by class, prepared/attempt, absorbed-task/prepare-hour,
duplicate-generation minutes) from real post-change samples. Must not weaken independent
ProposalReview, PlanCheck, Receipt integrity, wiring coverage, or the human decision boundary.

## Touches

Per `tasks/DIR-126.md`'s own `## Touches` list — not duplicated here (both `prepare-milestone.js`
mirrors, `proposal-convergence.ts`/`milestone-preparation-check.ts` + mirrors, a new
`prepare-admission-check.ts` + mirror, their test files, `OUTER-LOOP.md`, and the throughput-
capacity-model doc).

## Done-when

Per `tasks/DIR-126.md`'s own AC/DoD — with the split-decision AC treated as the gate it declares
itself to be (a formal SPLIT-OR-COMMIT artifact is required regardless of which way the decision
falls). At least 3 post-change real preparation generations of different terminal shapes, with
capacity metrics reproduced from checked-in workflow artifacts, not session prose.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
