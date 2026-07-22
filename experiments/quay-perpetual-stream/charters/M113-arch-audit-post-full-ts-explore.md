# Charter M113-arch-audit-post-full-ts-explore — Post-full-TS-migration architecture audit (mandatory explore)

**Milestone id:** M113  
**Task:** `tasks/exp5-M-ARCH-AUDIT-POST-FULL-TS.md` (to be created at dispatch; milestone-candidate)  
**Surface:** architecture analysis (archguard, methodology-class / explore)  
**Type:** methodology-class / explore  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

Mandatory explore at M113. The explore/exploit rule (≥1 explore per 5 milestones) fires: M109/M110/M111/M112 are all exploits (4 since M108 mandatory explore). An explore is required no later than M113.

This is the **first archguard run on the fully-migrated TypeScript codebase**. Since M108 (last archguard baseline), the following structural changes have landed:
- **M109:** 9 vendor-copy method-infra scripts `.mjs→.ts` (experiments/ only; not analyzed by archguard)
- **M110:** `it0-dod-check.mjs → .ts` + GATE-HASH-REF rotation (experiments/ only)
- **M111:** P4 parent task close (no code change)
- **M112:** P3 parent task close (no code change; `tasks/*.md` only)

For `packages/` (what archguard analyzes), the last structural change was M105 (M108 baseline). P3 migrations (M80–M85) changed file extensions and types but the import graph should be structurally unchanged.

**M108 baseline** (for comparison):
- entities=121, relations=156 (−5 vs M103: 126/163)
- `loadWorkspaceGates` outDegree=3 (CONFIRMED post-M105 fix)
- `startServer` outDegree=7 (WONTFIX baseline)
- `gate/factories/index.ts` barrel: new entry since M103
- No new god-packages, no new cycles

**Double-purpose:** This archguard run also satisfies the overall `exp5-M-TS-MIGRATION` parent's AC4 requirement:
> "archguard runs on the migrated product and yields an L_G/L_D reading recorded on the dashboard"

The M113 ABSORB entry + this charter's ABSORB metrics section constitute that record. The data will be cited when closing the overall TS migration parent (M114).

## Scope

**In scope (explore: DISCOVER only, FILE findings, never fix):**

1. **Run `archguard_analyze`** against current master HEAD (`projectRoot: "/home/yale/work/quay"`)
2. **Measure and compare vs M108 baseline:**
   - Entity count, relation count (expected: near 121/156 — only `packages/` product code analyzed; P3 TS renames don't add new entities, only update extension)
   - `archguard_summary` → `topByOutDegree` — confirm `loadWorkspaceGates` outDegree (~3 post-M105) and `startServer` outDegree (7, WONTFIX); note any new high-outDegree entries from TS migration
   - `archguard_get_package_metrics` for `gate/` and other migrated packages — has fanIn/fanOut changed after TS extension updates?
   - `archguard_detect_god_packages` — any new god-packages from the migration?
   - `archguard_detect_cycles` — any new cycles introduced by TS type imports?
3. **Record a structured comparison table** (M108 baseline → M113 post-full-migration measurement) in the ABSORB entry and in the task's Resolution section — this is the AC4 evidence artifact.
4. **File any NEW confirmed architectural findings** as `## Finding`-bearing milestone-candidate tasks (FILE-ONLY; gate through `routine-file-gate.ts --board tasks/`)

**Out of scope:**
- Fixing any findings (SELECT track does that)
- `experiments/quay-perpetual-stream/scripts/` — archguard analyzes `packages/` only
- Re-filing findings already on the board (dedup gate prevents double-filing)

## Class routing

**Methodology-class / explore** — no code changes allowed. FILE-ONLY invariant: after the explore fires, `git status --porcelain` shows only new `tasks/*.md` files (filed findings) and the task file for this milestone. NO changes to product or method code. Per OUTER-LOOP.md step 5b (explore path, no quay-task-to-plan required).

## Task creation

At dispatch, create `tasks/exp5-M-ARCH-AUDIT-POST-FULL-TS.md` with:
```yaml
---
id: exp5-M-ARCH-AUDIT-POST-FULL-TS
title: "Architecture audit post-full-TS-migration: archguard L_D/L_G run on fully-migrated product"
status: todo
labels:
  - milestone-candidate
  - explore
schema: v1
---
## Proposal
Post-full-TS-migration mandatory explore. Run archguard on packages/ (all P3+P4 done), compare vs M108 baseline (121/156 entities/relations), record L_G/L_D metrics. Satisfies exp5-M-TS-MIGRATION AC4.

## Acceptance Criteria
- [ ] Fresh archguard analysis on master HEAD post-M112; entity/relation counts vs M108 baseline documented.
- [ ] God-package + outDegree metrics re-measured; M108 expectations confirmed or deviations documented.
- [ ] Any new genuine architectural findings filed as milestone-candidate tasks with reproduction evidence, gated through routine-file-gate.ts.
- [ ] FILE-ONLY invariant held: git status shows only new task files, no code changes.

## Resolution
[POPULATED BY ITERATION EXECUTOR]
```

## Acceptance Criteria

- [ ] Fresh archguard analysis run on current master HEAD (post-M112); entity/relation counts updated vs M108 baseline.
- [ ] God-package + god-function metrics re-measured; `loadWorkspaceGates` and `startServer` outDegree confirmed by archguard.
- [ ] M108→M113 comparison table recorded in this task's Resolution section (the AC4 evidence artifact for the overall TS migration parent).
- [ ] Any new genuine architectural findings filed as milestone-candidate tasks with `## Finding` + reproduction evidence, gated through `routine-file-gate.ts`.
- [ ] FILE-ONLY invariant held: `git status --porcelain` shows only new task files, no code changes.

## Definition of Done

- [ ] Archguard re-run output pasted in ABSORB entry; M108→M113 comparison table shows which metrics changed.
- [ ] All new findings gated through `routine-file-gate.ts` (ACCEPT or REJECT documented for each); no finding filed without reproduction evidence.
- [ ] FILE-ONLY confirmed: no commits to product/method code; only task files created (if any).
- [ ] Resolution section in the milestone task populated with archguard data for AC4 citation.
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

`22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1`
