# M203 — DIR-126-D: per-generation phase telemetry for prepare-milestone.js (committed
milestones/prepare-telemetry/ records)

**Task:** DIR-126-D · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution · **highRisk:** yes

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). Fourth child of DIR-126's 5-way
split (`split-subsystem-blocking-cluster`/`mechanismCount=5` finding, M199/DIR-126's real
ProposalReview run). Closes DIR-126's own measured gap: 16 of 17 sampled real `prepare-milestone`
calls were non-success, yet only the success path (`Receipt` phase) writes structured telemetry
today — every failed/rejected/reused generation leaves no queryable artifact, forcing capacity
analysis to reconstruct numbers from raw session-journal prose (exactly what DIR-126's own Finding
had to do). Depends on [[DIR-126-A]] (landed `a0aba1f`/M200, `milestone_counter` 196→197 —
Admission's `key/ownerExecutionId/fencingToken` tuple is the generation-identity source),
[[DIR-126-B]] (landed `528897c`/M201, `milestone_counter` 197→198 — preflight verdict policy is a
real input/rejection shape), and [[DIR-126-C]] (landed `8c9d114`/M202, `milestone_counter`
198→199 — this child finalizes the generation-record shape C's `decideResumeGeneration` already
consumes in interim/frozen form, extending it, never breaking it).

## Why highRisk

This milestone edits `.claude/workflows/prepare-milestone.js` — the active control-plane script
every future milestone's Prepare stage runs through, the same risk class as DIR-126-A/B/C's own
charters — plus `milestone-preparation-check.ts`, the receipt integrity engine every Prepared-gate
check depends on. N=3 proposal authors and the extra delta-review round are warranted.

## Prepared-gate note

Dispatched under the M195/DIR-117-B enforced-by-default Prepared gate: carries a real
`prepare-milestone.js` receipt consumed by its `execute-milestone.js` dispatch.

## Scope

Per `tasks/DIR-126-D.md`'s own Requested action / Acceptance Criteria / Definition of Done — not
duplicated here. In short: one committed JSON telemetry record per dispatch attempt at
`milestones/prepare-telemetry/<taskId>/<recordId>.json`, written by whichever phase produces the
terminal outcome (not only `Receipt`) — Admission contention, Preflight rejection, ProposalAuthors/
Adjudicate/PlanAuthor/PlanCheck revision-needed, DIR-126-C's `reuse-terminal` decision, or a
successful `prepared`; a new `--telemetry` flag on `milestone-preparation-check.ts --build`
hash-binding the record into the receipt (mirroring the existing `--ledger` pattern exactly); a new
`--telemetry-report <milestoneId>` read-only query mode. Generation identity derives from
DIR-126-A's lease tuple, never bare session identity.

## Touches

Per `tasks/DIR-126-D.md`'s own `## Touches` list — not duplicated here (both `prepare-milestone.js`
mirrors, both `milestone-preparation-check.ts` mirrors, their test files, and the referenced
`docs/proposals/quay-prepare-execute-feedback-convergence.md`).

## Done-when

Per `tasks/DIR-126-D.md`'s own AC/DoD. A fresh independent audit explicitly briefed to trace the
real production telemetry-emit callsite at every phase boundary (not merely journal call counts or
unit-test reachability), confirm telemetry survives a real non-success generation (not only the
success path), and confirm instrumentation can never turn a failed preparation into a falsely
certified `prepared`.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
