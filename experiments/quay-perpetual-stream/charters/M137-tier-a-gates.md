# M137 — Gap 1 Tier A: 5 drop-in gates to plugin/scripts/

**Task:** DIR-070-B
**Milestone counter:** 137
**Chart:** 2
**Class:** development (capability-growth — shipped gate scripts)
**Value type:** capability-growth
**Cadence:** exploit
**Deliverable:** yes (5 gate scripts shipped to plugin/ for external workspace consumption)
**Charter tokens:** ~0.6 K
**type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (distribution infrastructure — no chart-2 surface cell directly moves).
Real value: 5 mechanical gate scripts become packageable plugin assets, consumable by
external quay workspaces through `quay:init`. Continues the deliverable chain from
M136 (DIR-070-A symlinks).

## Scope

Per `docs/proposals/exp5-deliverable-improvements.md` (section "Gap 1 Tier A"):
copy 5 drop-in-ready gate scripts from `experiments/scripts/` to `plugin/scripts/`,
add missing `.sh` wrappers, update gate configuration.

1. Copy `anti-gaming-guard.ts` + `.sh` wrapper to `plugin/scripts/`
2. Copy `loadbearing-test-gate.ts` + `.sh` wrapper to `plugin/scripts/`
3. Copy `tree-hygiene-check.sh` to `plugin/scripts/`
4. Copy `worktree-branch-hygiene-check.sh` to `plugin/scripts/`
5. Copy `drivable-workspace-check.ts` + `.sh` wrapper to `plugin/scripts/`
6. Update `.quay/config.yml` gate paths to plugin paths
7. Update `plugin/test/plugin-packaging.test.mjs`

## Touches

- `plugin/scripts/` (8 new files: 5 gates + 3 .sh wrappers)
- `.quay/config.yml` (gate paths)
- `plugin/test/plugin-packaging.test.mjs`

## Done-when (binary)

1. All 5 gate scripts present in `plugin/scripts/`.
2. All 3 `.sh` wrappers present (for `.ts` gates).
3. `.quay/config.yml` gate paths point to plugin paths.
4. All 5 gates runnable via `quay gate --gate <name>`.
5. `plugin-packaging.test.mjs` passes with no experiment leakage.
6. No `experiments/quay-perpetual-stream` or `exp5` strings in shipped files.

## Inner termination

Done-when-complete (6 clauses) OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
