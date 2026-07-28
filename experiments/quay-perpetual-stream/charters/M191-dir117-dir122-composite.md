# M191 — composite: DIR-117 (pre-Build Proposal/Plan gate) + DIR-122 (kind=gap schema tier)

**Task:** DIR-117, DIR-122 · **Composite candidate:** `composite:DIR-117+DIR-122`
**Member tasks (2):** DIR-117, DIR-122
**Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.8 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (capability-growth, deliverable). DIR-117 makes checked Proposal+Plan a non-bypassable
pre-Build gate (closing a real, disclosed bypass — `DIR-109` landed with a one-sentence Proposal
and an `N/A` Plan under the current, unenforced convention). DIR-122 adds a lightweight `kind=gap`
schema tier plus mechanism-claim wiring coverage for `## Requested action`, closing the schema-
marker blind spot found in a real survey of all 15 `tasks/gap-*.md` files (9 with zero structural
enforcement, 5 marked-but-failing).

## Why bundled as one composite dispatch (not two separate milestones)
Real, pairwise-verified via `touches-orthogonality-check.ts`: DIR-117 and DIR-122 are file-set
DISJOINT (DIR-117 touches `prepare-milestone.js`/`execute-milestone.js`/`quay-task-to-plan`/
`OUTER-LOOP.md`/`inherited-core.md`; DIR-122 touches `task-schema.ts`/`task-schema-check.ts`/
`plugin-packaging.test.mjs`/3 named gap-task files — zero overlap). But two genuinely separate
`Workflow()` dispatches would each independently increment `milestone_counter` and write
`dashboard.md`/`backlog.md`/`.quay/gate-events.jsonl` in their own Land phase — none of which
appear in either task's own `## Touches` (they're implicit Land side effects), so pairwise Touches
orthogonality alone does not prove safety against this race. Bundling into one composite manifest
(pre-validated below) gives one atomic Land — the same real mechanism M-DIR119-C-CANARY (M190)
already proved for 7 unrelated tasks — eliminating the shared-state race by construction. This is
NOT a claim of true concurrent Build execution (DIR-119-D, which would deliver that, has not landed
yet — Build here still runs as the current single-lead-oriented mechanism, one agent handling both
tasks); the benefit is one Verify/Gate/Land ceremony instead of two, with zero shared-state risk,
not parallel compute.

## Cold materialization record
- **Source commit (pre-dispatch HEAD):** `129dfef`.
- **Workflow script:** `.claude/workflows/execute-milestone.js`, re-read fresh via
  `Workflow({scriptPath: ...})` at dispatch time (never `name:`).
- **Dispatch form:** `{milestoneCandidate:{taskIds,...}, charterFile, compositeManifestFile,
  absorbEntryFile}` (DIR-119-B Stage 2.1 shape).
- **Manifest pre-validated:** `node --experimental-strip-types
  experiments/quay-perpetual-stream/scripts/composite-preflight.ts --args-json '...'` →
  `{"ok":true,"taskIds":["DIR-117","DIR-122"],"isComposite":true,"contractViolations":[]}`.
- **Composite manifest file:** `/home/yale/.claude/jobs/13efe277/tmp/m191-dir117-dir122-manifest.json`.

## Scope
Per `tasks/DIR-117.md` and `tasks/DIR-122.md`'s own Acceptance Criteria in full — not summarized
here to avoid a second, driftable copy (this repo's own single-source-of-truth discipline). Two
phases, one per task, no dependency between them (independently real, unrelated efforts):

1. **phase-DIR-117**: implement the `prepare-milestone` workflow, the mechanism-claim wiring
   coverage addition to the Proposal contract/grounded review, `milestone-preparation-check.ts`,
   OUTER-LOOP reordering, the `Prepared` gate in `execute-milestone`, and an explicit decision for
   schema-marker-less `gap-*` tasks (Requested action item 10) — then prove real landing with one
   subsequent real milestone per its own AC #11.
2. **phase-DIR-122**: land `gap-task-schema-plugin-mirror-touches-drift`'s fix first (re-sync the
   vendored `task-schema.ts` mirror), then add `classifyKind`'s `gap` case, the proportionate
   assertion set, and the mechanism-claim wiring coverage check on `## Requested action`; reconcile
   the `gap-symlink-mirror-noop-affects-5-more-scripts` / `gap-touches-orthogonality-symlink-
   isdirect-mismatch` duplicate (already done this session, prior to this charter — verify, don't
   redo); re-run `task-schema-check.ts tasks/gap-*.md` and report real before/after counts.

**Note on DIR-117's own bootstrap**: DIR-117's Plan text already anticipates this — "That resolving
milestone must itself be prepared manually under `.halt` before changing the preparation pipeline"
— this milestone is that manual preparation; DIR-117 cannot go through its own not-yet-built
Prepared gate.

**Out of scope for this milestone**: DIR-119-D and DIR-119 (parent) — sequenced strictly after this
one per real `touches-orthogonality-check.ts` OVERLAP findings (both later tasks overlap
`execute-milestone.js` with DIR-117; DIR-119 additionally overlaps `OUTER-LOOP.md`).

## Touches
- milestones/M191/**
- experiments/quay-perpetual-stream/charters/M191-dir117-dir122-composite.md
- experiments/quay-perpetual-stream/dashboard.md
- experiments/quay-perpetual-stream/backlog.md
- tasks/DIR-117.md
- tasks/DIR-122.md
- (per-member-task touches: see the composite manifest's `context.taskTouches` — union already
  validated via a real `composite-preflight.ts` run, `contractViolations: []`)

## Done-when
1. Both member tasks' own AC/DoD items are genuinely addressed (ticked with real evidence by the
   Audit step, per DIR-020 — not self-ticked by Build) and each task's own `status` reaches `done`,
   independently of the other (per-task provenance retained).
2. The composite-preflight mechanical check passes for real inside the Verify phase (not just the
   pre-dispatch validation pasted above).
3. Atomic Land increments `milestone_counter` exactly once and writes exactly one composite
   dashboard entry (not two separate entries).
4. Full/focused test suites green, including both new/modified real deliverables above.
5. DIR-117's own AC #11 (real subsequent milestone proving the Prepared-gate route) and DIR-122's
   own AC (real before/after `task-schema-check.ts tasks/gap-*.md` counts) are satisfied with real
   evidence, not asserted.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
