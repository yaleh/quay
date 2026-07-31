# M212 — DIR-119-D4: literal Reconcile phase as sole composite state writer + Gate-failure attribution fix

**Task:** DIR-119-D4 · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). Fourth child of DIR-119-D's
5-way split. No `Reconcile` phase exists in `execute-milestone.js`; `composite-reconcile.ts`'s
`reconcile()` is real and tested but reachable only via `--selftest`. Gate-phase failure
attribution hardcodes `_primaryTaskId` regardless of which member actually failed. This child
inserts a literal Reconcile phase as the sole composite state writer and fixes Gate attribution
with typed `{scope, taskId, gate, ok, detail}` records + `attributeGateFailures()`.
Depends on DIR-119-D3's Audit output (`BundleAuditResult`).

## Prepared-gate note

Dispatched under the M195/DIR-117-B enforced-by-default Prepared gate: carries a real
`prepare-milestone.js` receipt consumed by its `execute-milestone.js` dispatch.

## Scope

Per `tasks/DIR-119-D4.md`'s own Requested action / Acceptance Criteria / Definition of Done —
not duplicated here. In short: typed Gate results; `attributeGateFailures()` export on
`composite-reconcile.ts`; `--reconcile-json`/`--attribute-gates-json` CLI modes; literal
Reconcile phase in `meta.phases` between Gate and Land; `reconcile-apply` as ONLY composite
writer; RED/GREEN Gate-failure attribution fixture; real regression proof via journal.

## Touches

Per `tasks/DIR-119-D4.md`'s own `## Touches` list — not duplicated here.

## Done-when

Per `tasks/DIR-119-D4.md`'s own AC/DoD. A fresh independent wiring audit after Land, explicitly
briefed to trace the production import graph for `composite-reconcile.ts` AND exercise the
Gate-failure branch (the prior DIR-119-C audit's documented blind spot).

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ 26b651746d5f85f9fa317b65e204932089b75a16
