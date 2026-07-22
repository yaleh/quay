# Charter M108-arch-audit-post-ts-p4-explore — Post-M105 architecture audit (mandatory explore)

**Milestone id:** M108  
**Task:** `tasks/exp5-M-ARCH-AUDIT-M108-EXPLORE.md` (milestone-candidate)  
**Surface:** architecture analysis (archguard, methodology-class / explore)  
**Type:** methodology-class / explore  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

Mandatory explore at M108. The explore/exploit rule (≥1 explore per 5 milestones) fires: M104/M105/M106/M107 are all exploits (4 since M103 mandatory explore). An explore is required no later than M108.

Since the M103 archguard audit (baseline from that run), four milestones landed:
- **M104:** ARCH-M103-002 WONTFIX — `startServer` outDegree=7 documented as correct post-M100 baseline (handleAllRoutes edge is inherent); no structural change
- **M105:** ARCH-M103-001 fix — `loadWorkspaceGates` outDegree 8→3; `gateFactories` dispatch map added to `gate/factories/index.ts` (barrel now imports 7 factory functions, `loadWorkspaceGates` imports 1 map)
- **M106:** TS migration P4 Batch 1 — 9 method-infra scripts `.mjs→.ts`; no `packages/` product code touched
- **M107:** TS migration P4 Batch 2 — 7 method-infra scripts `.mjs→.ts`; no `packages/` product code touched

The only product-code structural change is M105's `gateFactories` map. M106/M107 affect only `experiments/quay-perpetual-stream/scripts/` which archguard does not analyze. The fresh archguard run will confirm M105's actual structural impact and check for any unexpected side effects.

## Scope

**In scope (explore: DISCOVER only, FILE findings, never fix):**

1. Run `archguard_analyze` against current master HEAD (`projectRoot: "/home/yale/work/quay"`)
2. Measure and compare vs M103 baseline:
   - Entity count, relation count
   - `archguard_summary` → `topByOutDegree` — confirm `loadWorkspaceGates` outDegree (expected ~3 post-M105) and `startServer` outDegree (expected 7, WONTFIX baseline); note `gate/factories/index.ts` new barrel entry
   - `archguard_get_package_metrics` for `gate/` — has fanOut changed after gateFactories barrel addition?
   - `archguard_detect_god_packages` — any new god-packages from the barrel?
   - `archguard_detect_cycles` — no new cycles from the updated import graph?
3. File any NEW confirmed architectural findings as `## Finding`-bearing milestone-candidate tasks (FILE-ONLY; gate through `routine-file-gate.ts --board tasks/`)
4. Write a structured comparison table (M103 baseline → M108 post-M105 measurement) in the ABSORB entry

**Out of scope:**
- Fixing any findings (SELECT track does that)
- `experiments/quay-perpetual-stream/scripts/` — archguard analyzes `packages/` only
- Re-filing findings already on the board (dedup gate prevents double-filing)
- M106/M107 TS renames — no `packages/` entities affected

## Class routing

**Methodology-class / explore** — no code changes allowed. FILE-ONLY invariant: after the explore fires, `git status --porcelain` shows only new `tasks/*.md` files (filed findings) and NO changes to product or method code. Per OUTER-LOOP.md step 5b (explore path, no quay-task-to-plan required).

## Acceptance Criteria

- [ ] Fresh archguard analysis run on current master HEAD (post-M107); entity/relation counts updated vs M103 baseline.
- [ ] God-package + god-function metrics re-measured; `loadWorkspaceGates` and `startServer` outDegree confirmed by archguard.
- [ ] Any new genuine architectural findings filed as milestone-candidate tasks with `## Finding` + reproduction evidence, gated through `routine-file-gate.ts`.
- [ ] FILE-ONLY invariant held: `git status --porcelain` shows only new task files, no code changes.

## Definition of Done

- [ ] Archguard re-run output pasted in ABSORB entry; M103→M108 comparison table shows which metrics changed.
- [ ] All new findings gated through `routine-file-gate.ts` (ACCEPT or REJECT documented for each); no finding filed without reproduction evidence.
- [ ] FILE-ONLY confirmed: no commits to product/method code; only task files created (if any).
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
