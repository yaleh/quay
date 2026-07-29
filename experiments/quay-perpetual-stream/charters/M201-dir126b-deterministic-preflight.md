# M201 — DIR-126-B: deterministic mechanical preflight for prepare-milestone.js (new Preflight
phase)

**Task:** DIR-126-B · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution · **highRisk:** yes

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). Second child of DIR-126's 5-way
split (`split-subsystem-blocking-cluster`/`mechanismCount=5` finding, M199/DIR-126's real
ProposalReview run). Adds mechanical, pre-content-agent-dispatch rejection for the five recurring
`prepare-milestone` failure classes DIR-126's own Finding names, so an objectively malformed
Proposal/Plan is rejected before any expensive LLM author/reviewer agent is spent — not after.
Depends on [[DIR-126-A]] (shares its new `prepare-admission-check.ts` module and the
pre-`ProposalAuthors` phase-insertion point; DIR-126-A landed at commit `a0aba1f`,
`milestone_counter` 196→197). Note: this child's Proposal, as authored by a concurrent
collaborator, originally framed closing the M198 `wiring-coverage-check.ts` merged-Markdown-list
false-positive class as part of its own deliverable — that class was independently closed and
landed (commit `335317d`, `gap-wiring-coverage-check-merged-markdown-list`) before this child's
Build begins; the task body was corrected accordingly (commit `ab28e40`) and this child's real
remaining scope is the five NEW `Preflight`-phase check functions.

## Why highRisk

This milestone edits `.claude/workflows/prepare-milestone.js` — the active control-plane script
every future milestone's Prepare stage runs through, the same class of risk DIR-126-A's own charter
flagged. N=3 proposal authors and the extra delta-review round are warranted.

## Prepared-gate note

Dispatched under the M195/DIR-117-B enforced-by-default Prepared gate: carries a real
`prepare-milestone.js` receipt consumed by its `execute-milestone.js` dispatch.

## Scope

Per `tasks/DIR-126-B.md`'s own Requested action / Acceptance Criteria / Definition of Done — not
duplicated here. In short: `runPreflightChecks`/`--preflight`/`--preflight-plan` entry points added
to `prepare-admission-check.ts` (+ `plugin/scripts/` mirror, shared module with DIR-126-A) with five
named pure check functions (stable codes: `preflight-merged-markdown-claims`,
`preflight-stale-ac-refs`, `preflight-touches-mismatch`, `preflight-missing-precedent`,
`preflight-invalid-plan-command`); a new `Preflight` phase in `prepare-milestone.js` (both mirrors)
right after `Admission` — the four content checks gate `ProposalAuthors`, the Plan-shape check gates
`PlanCheck` round 1; a checker policy version/hash on every verdict for DIR-126-C's cache
invalidation; fixtures seeded from real M192/M195/M196/M198 artifacts plus valid M195/M197-shaped
fixtures that must stay GREEN. Does NOT re-implement the already-landed `splitSentences`
merged-list fix (commit `335317d`) — reuses it as-is.

## Touches

Per `tasks/DIR-126-B.md`'s own `## Touches` list — not duplicated here (both `prepare-milestone.js`
mirrors, `prepare-admission-check.ts` canonical+mirror shared with DIR-126-A, `wiring-coverage-
check.ts` canonical+mirror — verify-only, not re-fix — and their test files).

## Done-when

Per `tasks/DIR-126-B.md`'s own AC/DoD. A fresh independent audit explicitly briefed to trace the
real production import graph for the new `Preflight` phase's callsite (both the content-check gate
before `ProposalAuthors` and the Plan-shape gate before `PlanCheck` round 1), not merely journal call
counts or unit-test reachability — and to confirm the `splitSentences` merged-list fix was reused,
not redundantly re-implemented.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
