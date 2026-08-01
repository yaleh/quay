---
id: gap-prepare-milestone-no-size-aware-routing-B
title: Fast-lane execution manifest + execute-milestone Verify consumption
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
extra:
  schema: v1
---
**type:** execution

## Proposal

For fast-lane tasks, replace the standalone prose Plan with a derived **execution
manifest** (30-100 line equivalent): ordered stages + dependencies, AC-to-stage and
AC-to-evidence mappings, bounded touch set, RED/GREEN and final verification commands, and
rollback/recovery requirements. The manifest is hash-bound and does NOT copy Proposal
content (no second requirement authority). It is the fast-lane task's prepared artifact:
`prepare-milestone.js`'s fast-lane path derives it in place of the checked
`docs/plans/*.md` plan, and the ENFORCED-BY-DEFAULT Prepared gate
(`milestone-preparation-check.ts`, which owns the `buildReceipt` receipt-builder) is
extended so a fast-lane receipt accepts the hash-bound manifest as the plan artifact
(`receipt.planFile` → the manifest path) instead of failing closed on
plan-not-checked/receipt-malformed before Verify.

`execute-milestone.js`'s Verify phase (step 4) is extended to consume the execution
manifest when present (fast-lane tasks) — closing the split-review finding that AC5
claimed Verify consumption but the Touches omitted `execute-milestone.js` and the
preparation-gate scripts.

Second child of the gap-size split. Depends on gap-size-A's fast-lane routing (the manifest
is the fast-lane Plan replacement).

## Plan

Checked plan authored at `docs/plans/M240-gap-prepare-milestone-no-size-aware-routing-b.md`
— the DIR-117-B prepared-gate artifact mapping every AC item to ordered mechanical stages
(RED/implementation/GREEN with expected exit behavior, code/prose classification, line
budgets, dependencies, guardrails/rollback/real-landing verification), with the standardized
3-round Plan-check stopping rule (success only at F_i = 0).

## Finding

Today `execute-milestone.js`'s Verify phase (step 4) runs the it0 mechanical checks
(ceiling-check/gate-hash/line-budget/dogfood-evidence/domain-misfit) plus
composite-preflight and reads no plan file; the checked `docs/plans/M<NN>-<slug>.md` plan
is consumed by the Prepared phase via `milestone-preparation-check.ts`. No execution
manifest exists. The fast-lane path (gap-size-A) needs a lighter artifact than a full
Plan. The split-review found AC5's Verify-consumption claim had no `execute-milestone.js`
touch — this child closes it.

## Requested action

1. Define the execution-manifest schema (ordered stages, dependencies, AC→stage/evidence,
   touch set, verification commands, rollback).
2. Prepare-milestone's fast-lane path derives the manifest (hash-bound, no Proposal copy),
   in place of the checked Plan for fast-lane tasks; extend the Prepared gate
   (`milestone-preparation-check.ts` / `prepare-admission-check.ts`) so a fast-lane
   receipt's `planFile` is the manifest.
3. `execute-milestone.js` Verify phase consumes the manifest when present (both mirrors),
   in place of the checked Plan for fast-lane tasks.
4. RED/GREEN fixtures: a manifest with a missing AC→stage mapping fails Verify; a complete
   one passes; a fast-lane task's Verify uses the manifest.

## Acceptance Criteria

- [ ] A fast-lane task produces a hash-bound execution manifest; `execute-milestone.js`
  Verify consumes it (real Verify-phase consumption, grep + real dispatch).
- [ ] The manifest has a schema-validated structure (AC→stage coverage, touch set, evidence
  mapping) and does not copy Proposal/Plan content.
- [ ] `execute-milestone.js` (both mirrors) has a real Verify-path branch for the manifest —
  `execute-milestone.js` is a declared Touches file of this child.
- [ ] RED/GREEN: missing AC→stage mapping in manifest fails Verify; complete passes.
- [ ] Tests: `execution-manifest-verify.test.mjs` RED/GREEN.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real fast-lane task's execute-milestone Verify consumes its manifest (real dispatch
  evidence).
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does execute-milestone Verify actually read the manifest for a fast-lane task?

## Touches

- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*execution-manifest*`
- `plugin/scripts/*execution-manifest*`
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`
- `plugin/scripts/milestone-preparation-check.ts`
- `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`
- `plugin/scripts/prepare-admission-check.ts`
- `experiments/quay-perpetual-stream/test/*execution-manifest*.test.mjs`
- `plugin/test/*execution-manifest*.test.mjs`
