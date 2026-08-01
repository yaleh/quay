---
id: gap-prepare-milestone-no-size-aware-routing-B
title: "Fast-lane execution manifest + execute-milestone Verify consumption"
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
content (no second requirement authority).

`execute-milestone.js`'s Verify phase is extended to consume the execution manifest (in
addition to the checked `docs/plans/*.md`) when present — closing the split-review finding
that AC5 claimed Verify consumption but the Touches omitted `execute-milestone.js`.

Second child of the gap-size split. Depends on gap-size-A's fast-lane routing (the manifest
is the fast-lane Plan replacement).

## Plan

N/A — resolved via a human-steered milestone. The resolving milestone authors a checked
`docs/plans/*.md` plan (DIR-117-B prepared-gate artifact) before implementation.

## Finding

Today `execute-milestone.js` Verify reads `docs/plans/M<NN>-<slug>.md` only; no execution
manifest exists. The fast-lane path (gap-size-A) needs a lighter artifact than a full
Plan. The split-review found AC5's Verify-consumption claim had no `execute-milestone.js`
touch — this child closes it.

## Requested action

1. Define the execution-manifest schema (ordered stages, dependencies, AC→stage/evidence,
   touch set, verification commands, rollback).
2. Prepare-milestone's fast-lane path derives the manifest (hash-bound, no Proposal copy).
3. `execute-milestone.js` Verify phase consumes the manifest when present (both mirrors),
   alongside the checked Plan.
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
- [ ] Tests: `execute-milestone-manifest-verify.test.mjs` RED/GREEN.

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
- `experiments/quay-perpetual-stream/test/*execution-manifest*.test.mjs`
- `plugin/test/*execution-manifest*.test.mjs`
