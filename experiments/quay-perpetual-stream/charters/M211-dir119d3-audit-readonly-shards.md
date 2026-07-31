# M211 — DIR-119-D3: wire Audit into per-shard, mechanically-enforced read-only dispatch (composite-audit.ts)

**Task:** DIR-119-D3 · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). Third child of DIR-119-D's
5-way split (`split-multi-mechanism` finding, M196/DIR-119-D's real ProposalReview run).
Audit currently dispatches exactly one agent regardless of composite width, and that agent
directly writes task/dashboard/absorb state — the exact mutation the target architecture
assigns to Reconcile. `composite-audit.ts`'s `runReadOnlyAuditShard()` is real and tested
but never on any production path; its `deepFreeze`/`structuredClone` isolation cannot
constrain a dispatched agent's real filesystem writes. This child wires per-shard dispatch
with a workflow-side mechanical `git status` diff as the real read-only enforcement.
Depends on DIR-119-D1's manifest shape and DIR-119-D2's Build phase.

## Prepared-gate note

Dispatched under the M195/DIR-117-B enforced-by-default Prepared gate: carries a real
`prepare-milestone.js` receipt consumed by its `execute-milestone.js` dispatch.

## Scope

Per `tasks/DIR-119-D3.md`'s own Requested action / Acceptance Criteria / Definition of Done —
not duplicated here. In short: add snapshot/guard and `--combine-json` CLI modes to
`composite-audit.ts` (+ mirror); strip composite write instructions from Audit prompt;
dispatch one `audit-shard-<id>` agent per shard with workflow-side before/after `git status`
snapshot diff (hard-fail on any delta); dispatch `audit-combine` invoking real
`combineShardVerdicts()`; RED/GREEN hostile-write fixture; real regression proof via journal.

## Touches

Per `tasks/DIR-119-D3.md`'s own `## Touches` list — not duplicated here.

## Done-when

Per `tasks/DIR-119-D3.md`'s own AC/DoD. A fresh independent wiring audit after Land, explicitly
briefed to trace the production import graph for `composite-audit.ts` (not `--selftest`-only
reachability).

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ 26b651746d5f85f9fa317b65e204932089b75a16
