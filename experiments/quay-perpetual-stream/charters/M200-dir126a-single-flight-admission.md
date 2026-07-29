# M200 — DIR-126-A: single-flight admission for prepare-milestone.js (prepare-admission-check.ts,
new Admission phase)

**Task:** DIR-126-A · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution · **highRisk:** yes

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). First child of DIR-126's 5-way
split (`split-subsystem-blocking-cluster`/`mechanismCount=5` finding, M199/DIR-126's real
ProposalReview run). Closes the concrete overlap DIR-126's own Finding measured: two M196
generations for the same task overlapped, adding ~54 duplicate workflow-minutes, because
`prepare-milestone.js` has no admission/ownership check at all today. No dependencies within this
split; DIR-126-B (deterministic preflight) shares this child's new module; DIR-126-C
(generation-aware resume) treats a resume dispatch as itself an admission event and depends on
this child landing first.

## Why highRisk

This milestone edits `.claude/workflows/prepare-milestone.js` — the active control-plane script
every future milestone's Prepare stage runs through, the same class of risk M196/DIR-119-D's
charter flagged for `execute-milestone.js`. N=3 proposal authors and the extra delta-review round
are warranted.

## Prepared-gate note

Dispatched under the M195/DIR-117-B enforced-by-default Prepared gate: carries a real
`prepare-milestone.js` receipt consumed by its `execute-milestone.js` dispatch.

## Scope

Per `tasks/DIR-126-A.md`'s own Requested action / Acceptance Criteria / Definition of Done — not
duplicated here. In short: new module `prepare-admission-check.ts` (+ `plugin/scripts/` mirror)
implementing `acquireLease`/`renewLease`/`releaseLease`/`checkStaleOwner` (atomic `wx`-create
lease at a gitignored `.quay/prepare-leases/<taskId>.json` path, reusing DIR-124's lease-record
vocabulary); a new `Admission` phase in `prepare-milestone.js` (both mirrors) dispatched before
`phase('ProposalAuthors')`, unconditionally including under `resumeFromAdjudicatedProposal`;
renewal at every existing phase boundary; the corrected 300-minute (ordinary) / 360-minute
(highRisk) staleness window (a real, derived sum — not the earlier draft's contradicted 90/150
figures); a real two-concurrent-dispatch regression proof showing exactly one reaches
`ProposalAuthors` and the other returns `prepare-already-running` before any author agent is spent.

## Touches

Per `tasks/DIR-126-A.md`'s own `## Touches` list — not duplicated here (both `prepare-milestone.js`
mirrors, the new `prepare-admission-check.ts` canonical+mirror, their test files, and one
`.gitignore` line).

## Done-when

Per `tasks/DIR-126-A.md`'s own AC/DoD. A fresh independent audit explicitly briefed to trace the
real production import graph for the new `Admission` phase's callsite, not merely journal call
counts or unit-test reachability.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
