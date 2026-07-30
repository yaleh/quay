# M205 — gap-wiring-coverage-check-whose-own-and-bold-marker-splitting: fix two confirmed
wiring-coverage-check.ts regex defects

**Task:** gap-wiring-coverage-check-whose-own-and-bold-marker-splitting · **Class:** development
**Value type:** capabilityGrowth · **Deliverable:** yes · **Charter tokens:** ~0.1 K
**type:** execution · **highRisk:** no

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). Two confirmed, source-read-verified
defects in `wiring-coverage-check.ts` — `WIRING_VERB_RE`'s possessive-determiner exclusion omits
`whose`, and `splitSentences()` never splits before a markdown bold marker (`**`) — cost DIR-126-D's
own real ProposalReview convergence a full extra round (~20 real minutes, 12 agents, ~700K tokens)
when its own explanatory prose re-triggered false uncovered-claim findings. A small, mechanical,
low-risk fix with real regression fixtures reduces this exact class of wasted convergence rounds for
every future milestone that authors similarly-shaped explanatory prose.

## Why not highRisk

Touches only `wiring-coverage-check.ts` (+ `plugin/scripts/` mirror) and its test file — a pure-logic
regex fix with dedicated RED/GREEN fixtures, not `prepare-milestone.js`'s own control-plane script
or any decision-making logic. Two precisely-scoped regex edits, not a redesign.

## Scope

Per `tasks/gap-wiring-coverage-check-whose-own-and-bold-marker-splitting.md`'s own Requested action
/ Acceptance Criteria / Definition of Done — not duplicated here.

## Touches

Per the task's own `## Touches` list — not duplicated here.

## Done-when

Per the task's own AC/DoD. A fresh independent audit confirms both regex fixes are real,
source-confirmed, and the new regression fixtures actually fail before the fix and pass after
(RED/GREEN, not GREEN-only).

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
