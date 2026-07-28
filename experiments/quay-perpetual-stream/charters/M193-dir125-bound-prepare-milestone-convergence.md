# M193 — DIR-125: bound prepare-milestone Proposal convergence

**Task:** DIR-125 · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.5 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable). `prepare-milestone.js`'s ProposalReview phase has no
round cap, unlike PlanCheck's existing ≤3-round/`F_i=0` rule — a real, ongoing exercise against
DIR-120/M192 hit 10 consecutive full-regeneration rounds (finding sequence `8→2→1→1→1→2→2→1→2→1`)
without reaching PlanAuthor, costing ~3h15m active workflow time and ~1.13M output tokens for real,
valuable findings that a bounded, incremental process could have captured far more cheaply. This
milestone bounds that loop: one full Proposal synthesis per generation, typed/disposition-tracked
findings, focused delta revision instead of full regeneration, and an explicit stop budget.

## Why skip `prepare-milestone` for this milestone specifically

Dispatching this task's own preparation through the mechanism it is fixing risks the exact
unbounded loop it exists to close (and DIR-125's own Proposal is already well-grounded, specific,
and directly derived from this session's real DIR-120 dispatch history — not a thin draft needing
independent re-derivation). Direct `execute-milestone` dispatch is the pragmatic, human-directed
choice for this one task; it does not set a precedent for skipping preparation generally.

## Scope

Per `tasks/DIR-125.md`'s own Acceptance Criteria and Definition of Done — not summarized here to
avoid a second, driftable copy. In short: add an internal bounded convergence loop to
`prepare-milestone.js` (both mirrors) — one full Proposal synthesis (authors + adjudicator) per
generation, a typed finding ledger (stable ID, severity, blocking, disposition, evidence,
claim/AC mapping) replacing the scalar `{findings, findingsDetail}` result, a focused-reviser +
delta-review path for subsequent rounds (never re-running authors/adjudicator), a hard cap
(1 full + ≤2 delta reviews ordinary, +1 for `highRisk`), soft time budgets (45m/75m, checked before
admitting the next phase, never killing an in-flight one), a split checkpoint for
multi-blocking-cluster candidates, and updated `OUTER-LOOP.md`/`quay-task-to-plan` guidance
reflecting the new stopping rule.

## Touches

Per `tasks/DIR-125.md`'s own `## Touches` list — not duplicated here.

## Done-when

Per `tasks/DIR-125.md`'s own AC/DoD — real workflow-integration fixtures (bounded convergence,
persistent-blocker cap, high-risk extra round, mixed blocking/non-blocking disposition, split
checkpoint, soft-budget clock injection, ledger hash-binding, zero-finding backward-compat, and a
DIR-120-shaped replay) plus real dispatch-count evidence, not prompt-text assertion.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
