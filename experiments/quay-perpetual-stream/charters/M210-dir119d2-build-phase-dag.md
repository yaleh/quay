# M210 — DIR-119-D2: wire Build into a real phase-DAG dispatcher (composite-build.ts)

**Task:** DIR-119-D2 · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). Second child of DIR-119-D's
5-way split (`split-multi-mechanism` finding, M196/DIR-119-D's real ProposalReview run).
`composite-build.ts`'s `planPhaseExecution`/`mapEvidenceToTasks` are real, tested, exported
functions with zero non-test production importers — Build dispatches exactly one monolithic
agent regardless of manifest width. This child wires a real per-phase dispatcher into
`execute-milestone.js`'s composite Build path. Depends on DIR-119-D1's real, checked-in
`composite-manifest-synthesis.ts` output shape (landed M198).

## Prepared-gate note

Dispatched under the M195/DIR-117-B enforced-by-default Prepared gate: carries a real
`prepare-milestone.js` receipt consumed by its `execute-milestone.js` dispatch.

## Scope

Per `tasks/DIR-119-D2.md`'s own Requested action / Acceptance Criteria / Definition of Done —
not duplicated here. In short: add `--plan-json`/`--map-evidence-json` non-selftest CLI modes
to `composite-build.ts` (+ mirror); change `execute-milestone.js`'s (both mirrors) composite
Build path to dispatch `build-plan`, then per-batch `parallel()` of `build-phase-<id>` agents
respecting `requires`, then `build-integrate`; legacy width-1 completely untouched; real
regression proof via a fresh composite dispatch with journal evidence.

## Touches

Per `tasks/DIR-119-D2.md`'s own `## Touches` list — not duplicated here.

## Done-when

Per `tasks/DIR-119-D2.md`'s own AC/DoD. A fresh independent wiring audit after Land, explicitly
briefed to trace the production import graph for `composite-build.ts` (not `--selftest`-only
reachability).

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ 26b651746d5f85f9fa317b65e204932089b75a16
