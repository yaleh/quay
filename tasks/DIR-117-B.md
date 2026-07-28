---
id: DIR-117-B
title: Prove the Prepared-gate preparation pipeline via one real subsequent
  milestone (DIR-117 AC#11/DoD real-landing)
status: todo
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-117
children: []
extra:
  schema: v1
  dirStatus: applied
---
**type:** execution

## Proposal

DIR-117 (M191) landed the preparation MECHANISM for real: `prepare-milestone.js` (`.claude/workflows/`
+ `plugin/workflows/`, byte-identical), `milestone-preparation-check.ts` (canonical +
`plugin/scripts/` mirror via `sync-vendor.sh`'s `SYNC_SCRIPTS` group, 12 unit tests, 4 negative
mutation fixtures + 1 unrelated-file-no-op fixture all independently passing), the shared
`wiring-coverage-check.ts` mechanism-claim wiring coverage module (9 unit tests, RED/GREEN pair),
`OUTER-LOOP.md`'s `prepare(c)` step definition, and `execute-milestone.js`'s opt-in `Prepared` phase
(both mirrors, `execute-milestone-disposition-conformance.test.mjs` unaffected, 16/16 pass).

What M191 could NOT do, by construction (DIR-117's own bootstrap-paradox note: "this directive
cannot go through its own not-yet-built Prepared gate" / "That resolving milestone must itself be
prepared manually under `.halt`"): run `prepare-milestone.js` for real against a live OUTER-LOOP
SELECT cycle and prove the full preparation → Prepared-gate → Build route on ONE REAL subsequent
milestone (DIR-117's own AC #11 / DoD real-landing clause). This is the SAME split DIR-119-A/B/C
already used for an structurally identical problem (DIR-119-A/B landed the composite-milestone
CONTRACT + mechanism disclosed-as-not-yet-operationally-proven; DIR-119-C supplied the real cold
proof one milestone later) — DIR-026 SPLIT-OR-COMMIT: create a completable child rather than defer
missing enforcement in prose.

**Mechanism-claim wiring coverage (DIR-117's own required-on-itself check):** this Proposal claims
`prepare-milestone.js` dispatches `milestone-preparation-check.ts` and that `execute-milestone.js`'s
`Prepared` phase enforces the receipt — AC items 1 and 2 below require real production evidence for
exactly those two relationships.

## Plan

N/A — directive resolved via a human-steered milestone (same class/discipline as its parent
DIR-117). The resolving milestone should: (1) SELECT one real, otherwise-independent candidate
task; (2) dispatch `prepare-milestone.js` for it for real (not a fixture) — proposal authors →
adjudication → review → Plan author → Plan-check → receipt; (3) dispatch `execute-milestone.js`
with `preparationReceiptFile` set to the real receipt path, confirming the `Prepared` phase runs and
passes; (4) as a negative control in the SAME milestone or a throwaway companion run, show a stale/
missing receipt returns `{outcome:"revision-needed", phase:"Prepared"}` before Build; (5) once proven,
flip `execute-milestone.js`'s default so a MISSING `preparationReceiptFile` itself becomes the
non-bypassable failure mode (closing the current back-compat opt-in), and update `OUTER-LOOP.md`'s
`prepare(c)` STATUS note accordingly.

## Finding

See `tasks/DIR-117.md`'s own `## Finding`/`## Requested action`/`## Acceptance Criteria` for the
full original problem statement — unchanged, this child only carries the one real-landing proof
DIR-117 itself could not self-certify.

## Requested action

1. Real SELECT → `prepare-milestone.js` → `execute-milestone.js(preparationReceiptFile=...)` run on
   one real candidate task, with the resulting task/`docs/plans/*.md`/`preparation.json`/workflow
   journal/iteration report jointly showing implementation began only after Proposal and Plan
   checks reached zero findings.
2. A real negative-control run (stale/missing receipt) shows `execute-milestone.js` returns before
   Build with `phase: "Prepared"` and `outcome: "revision-needed"`.
3. Flip `execute-milestone.js`'s `Prepared` phase from opt-in to the enforced default (a MISSING
   `preparationReceiptFile` becomes fail-closed, not skip-with-INFO) once (1)/(2) are proven; update
   `OUTER-LOOP.md`'s disclosure note.

## Acceptance Criteria

- [ ] Real production evidence (workflow journal + `preparation.json` + `docs/plans/*.md`) confirms
  `prepare-milestone.js` actually dispatches `milestone-preparation-check.ts` for a real (non-
  fixture) task and produces a receipt that a real subsequent `execute-milestone.js` call consumes.
- [ ] Real production evidence confirms `execute-milestone.js`'s `Prepared` phase enforces the
  receipt supplied via `preparationReceiptFile` — a real run with a stale/missing receipt returns
  `{outcome:"revision-needed", phase:"Prepared"}` before Build; a real run with a valid receipt
  reaches Build.
- [ ] `execute-milestone.js`'s `Prepared` phase default is flipped from opt-in-skip to enforced-by-
  default (both `.claude/workflows/` and `plugin/workflows/` mirrors, byte-identical), and
  `OUTER-LOOP.md`'s M191 disclosure note is updated to reflect the real-landing proof instead of
  "not yet proven."
- [ ] `node experiments/quay-perpetual-stream/scripts/task-schema-check.ts tasks/DIR-117-B.md` exits
  0.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply, including
adversarial acceptance audit, V_meta consolidation-lag, line budget, test floor, tree/worktree
hygiene, and audit independence. Per DIR-026 Reading A, a synthetic fixture alone is necessary but
insufficient — done only when:

- [ ] One REAL milestone (not a scratch task) shows checked Proposal, checked Plan, matching
  preparation receipt, and workflow evidence that Build started only after the Prepared gate
  passed — landed on `master`.
- [ ] `execute-milestone.js`'s `Prepared` phase is the enforced default (not opt-in) in both
  mirrors, with a real negative-control run proving fail-closed behavior.
- [ ] Parent `tasks/DIR-117.md`'s own DoD item ("task remains dirStatus: pending until that real
  milestone lands") is satisfied by THIS child's landing, and DIR-117's own `dirStatus`/Resolution
  is updated to point at this child's real evidence.

## Touches

- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js
- experiments/quay-perpetual-stream/OUTER-LOOP.md
- milestones/**
- docs/plans/**
