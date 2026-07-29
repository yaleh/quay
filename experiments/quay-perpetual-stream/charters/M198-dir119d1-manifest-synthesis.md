# M198 — DIR-119-D1: real manifest phase/shard synthesis at the SELECT/dispatch boundary

**Task:** DIR-119-D1 · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). First child of DIR-119-D's
5-way split (`split-multi-mechanism` finding, M196/DIR-119-D's real ProposalReview run). No
production manifest phase/shard synthesis exists anywhere — the only `CompositePhase[]` producer
is a test fixture, and SELECT's real pipeline emits only a flat candidate record. Every downstream
DIR-119-D child (D2 Build, D3 Audit, D4 Reconcile, D5 Land) needs a real synthesized manifest to
prove its own real journal evidence against — this child is the load-bearing first step with no
dependencies within the split.

## Prepared-gate note

Dispatched under the M195/DIR-117-B enforced-by-default Prepared gate: carries a real
`prepare-milestone.js` receipt consumed by its `execute-milestone.js` dispatch.

## Scope

Per `tasks/DIR-119-D1.md`'s own Requested action / Acceptance Criteria / Definition of Done — not
duplicated here. In short: new module `composite-manifest-synthesis.ts` (+ `plugin/scripts/`
mirror + test file) implementing `synthesizeManifest()` — pure function taking a real SELECT
`MilestoneCandidate` + task facts + coupling graph, returning `{manifest, context}`; reuses (not
reinvents) `touches-orthogonality-check.ts`/`coupling-graph.ts` exports; fuses overlapping Touches
into shared phases; calls `checkCompositeContract()` on its own output before writing
(temp-file-plus-rename, fail-closed); CLI wrapping it. Updates the single real
`.claude/workflows/select-preflight.js` file to pass through the real portfolio/candidate, and
`OUTER-LOOP.md`'s `execute()` step to invoke the synthesis CLI + thread `compositeManifestFile`.
Real regression proof: exercise on a REAL SELECT-produced candidate, confirm output satisfies the
UNCHANGED `composite-preflight.ts` contract check, and produces more than one phase when Touches
are genuinely disjoint.

## Touches

Per `tasks/DIR-119-D1.md`'s own `## Touches` list — not duplicated here.

## Done-when

Per `tasks/DIR-119-D1.md`'s own AC/DoD. A fresh independent wiring audit after Land, explicitly
briefed to trace the production import graph for the new synthesis callsite (not `--selftest`-only
reachability).

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ 26b651746d5f85f9fa317b65e204932089b75a16
