# M202 — DIR-126-C: generation-aware resume for prepare-milestone.js (decideResumeGeneration in
proposal-convergence.ts)

**Task:** DIR-126-C · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution · **highRisk:** yes

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). Third child of DIR-126's 5-way
split (`split-subsystem-blocking-cluster`/`mechanismCount=5` finding, M199/DIR-126's real
ProposalReview run). Replaces the caller-supplied, prose-documented-only
`resumeFromAdjudicatedProposal` boolean with a fail-closed, hash/provenance-derived three-state
decision (`cold`/`resume`/`reuse-terminal`) — closes the exact caller-judgment risk class DIR-126's
own Finding names as gap 3, and is the direct control that would have prevented M196's repeated
duplicate-generation overlap this whole split exists to close. Depends on [[DIR-126-A]] (landed
`a0aba1f`/M200, `milestone_counter` 196→197 — a resume/reuse attempt is itself an admission event;
Admission must run and succeed before any resume-vs-reuse-vs-cold decision matters) and on
[[DIR-126-B]] (landed `528897c`/M201, `milestone_counter` 197→198 — this child's
`currentReviewPolicyHash` input covers B's preflight checker version/hash, so a detector-policy
change correctly invalidates a stale resume/reuse decision).

## Why highRisk

This milestone edits `.claude/workflows/prepare-milestone.js` — the active control-plane script
every future milestone's Prepare stage runs through, the same class of risk DIR-126-A/DIR-126-B's
own charters flagged. N=3 proposal authors and the extra delta-review round are warranted.

## Prepared-gate note

Dispatched under the M195/DIR-117-B enforced-by-default Prepared gate: carries a real
`prepare-milestone.js` receipt consumed by its `execute-milestone.js` dispatch.

## Scope

Per `tasks/DIR-126-C.md`'s own Requested action / Acceptance Criteria / Definition of Done — not
duplicated here. In short: `decideResumeGeneration({priorGenerationRecord, currentCharterHash,
currentTaskContractHash, currentTaskProposalHash, currentReviewPolicyHash, callerOverride})` added
to `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` (+ `plugin/scripts/`
mirror), wired into `prepare-milestone.js` (both mirrors) at the point
`_resumeFromAdjudicatedProposal` is read today, invoked only when the caller omits
`resumeFromAdjudicatedProposal` (explicit `true`/`false` keep today's byte-identical behavior); a
new `reuse-terminal` decision path that re-emits a cacheable prior terminal (narrow allowlist:
deterministic `preflight-rejected`/`split-recommended`) with zero content/review agent dispatches,
releasing DIR-126-A's Admission lease before returning; `ProposalReview`'s round-0 full review stays
unconditional for every executing generation. Fail-closed to `cold` on any undecidable case (missing
record, hash mismatch, exception, non-cacheable terminal).

## Touches

Per `tasks/DIR-126-C.md`'s own `## Touches` list — not duplicated here (both
`prepare-milestone.js` mirrors, `proposal-convergence.ts` canonical+mirror, and their test files).

## Done-when

Per `tasks/DIR-126-C.md`'s own AC/DoD. A fresh independent audit explicitly briefed to trace the
real production import graph for `decideResumeGeneration`'s callsite, confirm
`ProposalReview`'s round-0 review genuinely stays unconditional under both forced and automatic
resume, and confirm `reuse-terminal` cannot advance to PlanAuthor/Receipt — not merely journal call
counts or unit-test reachability.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
