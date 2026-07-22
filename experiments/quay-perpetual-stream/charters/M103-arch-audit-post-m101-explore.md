# Charter M103-arch-audit-post-m101-explore — Post-M101 architecture audit (mandatory explore)

**Milestone id:** M103  
**Task:** `tasks/exp5-M-ARCH-AUDIT-M103-EXPLORE.md` (milestone-candidate)  
**Surface:** architecture analysis (archguard, methodology-class / explore)  
**Type:** methodology-class / explore  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

Mandatory explore at M103. The explore/exploit rule (≥1 explore per 5 milestones) fires: M99/M100/M101/M102 are all exploits (4 since M98 mandatory explore). An explore is required no later than M103.

Since the M98 archguard audit (baseline: ~92 entities, ~131 relations, PROBE-M98-001 filed), four structural milestones landed:
- **M99:** `registerAllHandlers()` facade in `mcp-handlers.ts` — outDegree 7→3 for `startMcpServer`
- **M100:** `startServer` decomposition — `serve.ts` 1085L→101L; `serve-handlers.ts` new (1068L); 5 route handlers + 8 rendering helpers extracted; `startServer` body 675L→65L
- **M101:** `gate/registry.ts` factory split — `registry.ts` 736L→118L; `gate/factories/` directory with 10 new files (7 factories + utils.ts + loader.ts + index.ts)
- **M102:** `loop.yml` wiring + selfcheck tests (config change only; no new entities)

M100 and M101 are the most structurally significant: both add new files to the analyzed codebase and substantially reorganize existing ones. The fresh archguard run will measure the real structural impact and may reveal new findings created by `serve-handlers.ts` or `gate/factories/`.

## Scope

**In scope (explore: DISCOVER only, FILE findings, never fix):**

1. Run `archguard_analyze` against current master HEAD (`projectRoot: "/home/yale/work/quay"`)
2. Measure and compare vs M98 baseline:
   - Entity count (was ~92), relation count (was ~131)
   - `archguard_summary` → `topByOutDegree` — confirm `startServer` rank and `startMcpServer` rank updated; note new top entries from `serve-handlers.ts` / `gate/factories/`
   - `archguard_get_package_metrics` for `gate/` — has fanOut changed after factory split? (Was fanOut=62; factory files are intra-package so expect same fanOut but different per-file distribution)
   - `archguard_detect_god_packages` — any new god-packages? `serve-handlers.ts` (1068L) and `gate/factories/` together add significant entity count
   - `archguard_detect_cycles` — no new cycles from the new import graphs?
3. File any NEW confirmed architectural findings as `## Finding`-bearing milestone-candidate tasks (FILE-ONLY; gate through `routine-file-gate.mjs --board tasks/`)
4. Write a structured comparison table (M98 baseline → M103 post-M101 measurement) in the ABSORB entry

**Out of scope:**
- Fixing any findings (SELECT track does that)
- `experiments/quay-perpetual-stream/scripts/` — archguard analyzes `packages/` only
- Re-filing findings already on the board (dedup gate prevents double-filing)
- M102 `loop.yml` config change — no code entities affected

## Class routing

**Methodology-class / explore** — no code changes allowed. FILE-ONLY invariant: after the explore fires, `git status --porcelain` shows only new `tasks/*.md` files (filed findings) and NO changes to product or method code. Per OUTER-LOOP.md step 5b (explore path, no quay-task-to-plan required).

## Acceptance Criteria

- [ ] Fresh archguard analysis run on current master HEAD (post-M101); entity/relation counts updated vs M98 baseline.
- [ ] God-package + god-function metrics re-measured; `startServer` and `startMcpServer` outDegree confirmed by archguard.
- [ ] Any new genuine architectural findings filed as milestone-candidate tasks with `## Finding` + reproduction evidence, gated through `routine-file-gate.mjs`.
- [ ] FILE-ONLY invariant held: `git status --porcelain` shows only new task files, no code changes.

## Definition of Done

- [ ] Archguard re-run output pasted in ABSORB entry; M98→M103 comparison table shows which metrics changed.
- [ ] All new findings gated through `routine-file-gate.mjs` (ACCEPT or REJECT documented for each); no finding filed without reproduction evidence.
- [ ] FILE-ONLY confirmed: no commits to product/method code; only task files created.
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
