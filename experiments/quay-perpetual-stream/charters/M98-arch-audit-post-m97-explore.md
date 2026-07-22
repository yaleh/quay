# Charter M98-arch-audit-post-m97-explore — Post-M97 architecture audit (mandatory explore)

**Milestone id:** M98  
**Task:** `tasks/exp5-M-ARCH-AUDIT-M98-EXPLORE.md` (milestone-candidate)  
**Surface:** architecture analysis (archguard, methodology-class / explore)  
**Type:** methodology-class / explore  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

Mandatory explore at M98. The explore/exploit rule (≥1 explore per 5 milestones) fires: M94/95/96/97 are all exploits (4 since M93 mandatory explore). An explore is required no later than M98.

Since the M93 archguard audit (baseline: 87 entities, 125 relations, 4 findings filed), three structural milestones landed:
- **M95:** ABI boundary fix — added `"exports"` field to `packages/quay/package.json`; updated 4 import specifiers in `quay-native`
- **M96:** routine-file-gate `boardKeys()` fix — `excludePath` parameter added (`experiments/quay-perpetual-stream/scripts/routine-file-gate.mjs` + vendored plugin copy)
- **M97:** `startMcpServer` decomposition — 808-line god-function split into 187-line thin wrapper (`mcp-server.ts`) + 672-line handler module (`mcp-handlers.ts`); new file added to `packages/quay/src/`

The M97 decomposition is the most structurally significant change: it adds a new file to the analyzed codebase and fundamentally changes `mcp-server.ts`'s entity-level dependency graph. A fresh archguard run will confirm the outDegree reduction is real in archguard's own measurements and may reveal new structural patterns (or findings) created by `mcp-handlers.ts`.

## Scope

**In scope (explore: DISCOVER only, FILE findings, never fix):**

1. Run `archguard_analyze` (or re-analyze) against current master HEAD (`projectRoot: "/home/yale/work/quay"`)
2. Measure and compare vs M93 baseline:
   - Entity count (was 87), relation count (was 125)
   - `archguard_summary` → `topByOutDegree` — confirm `startMcpServer` rank 1 eliminated; note new top entries
   - `archguard_get_package_metrics` for `gate/` — confirm fanOut, fanIn, entityCount vs M93 (was fanOut=62, fanIn=7, entityCount=52)
   - `archguard_detect_god_packages` — any new god-packages? `mcp-handlers.ts` adds ~672 lines to `src/`
   - `archguard_detect_cycles` — no new cycles from the new import graph?
3. File any NEW confirmed architectural findings as `## Finding`-bearing milestone-candidate tasks (FILE-ONLY; gate through `routine-file-gate.mjs --board tasks/`)
4. Write a structured comparison table (M93 baseline → M98 post-M97 measurement) in the ABSORB entry

**Out of scope:**
- Fixing any findings (SELECT track does that)
- M96 scripts (`experiments/quay-perpetual-stream/scripts/`) — archguard analyzes `packages/` only
- Re-filing findings already on the board (ARCH-M93-001, ARCH-M93-003 are still open; dedup gate prevents double-filing)

## Class routing

**Methodology-class / explore** — no code changes allowed. FILE-ONLY invariant: after the explore fires, `git status --porcelain` shows only new `tasks/*.md` files (filed findings) and NO changes to product or method code. Per OUTER-LOOP.md step 5b (explore path, no quay-task-to-plan required).

## Acceptance Criteria

- [ ] Fresh archguard analysis run on current master HEAD (post-M97); entity/relation counts updated vs M93 baseline.
- [ ] God-package + god-function metrics re-measured; `startMcpServer` outDegree confirmed by archguard (expected ~0, AC requires ≤4).
- [ ] Any new genuine architectural findings filed as milestone-candidate tasks with `## Finding` + reproduction evidence, gated through `routine-file-gate.mjs`.
- [ ] FILE-ONLY invariant held: `git status --porcelain` shows only new task files, no code changes.

## Definition of Done

References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] Archguard re-run output pasted in ABSORB entry; M93→M98 comparison table shows which metrics changed.
- [ ] All new findings gated through `routine-file-gate.mjs` (ACCEPT or REJECT documented for each); no finding filed without reproduction evidence.
- [ ] FILE-ONLY confirmed: no commits to product/method code; only task files created.
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`  
(SHA-256 of `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` at charter time)
