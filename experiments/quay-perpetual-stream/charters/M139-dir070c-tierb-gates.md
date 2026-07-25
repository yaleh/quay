# M139 — Parameterize 5 Tier B gates and move to plugin/scripts/

**Task:** DIR-070-C
**Milestone counter:** 139
**Chart:** 2
**Class:** methodology (capability-growth — deliverable infrastructure)
**Value type:** capability-growth
**Cadence:** exploit
**Deliverable:** yes (plugin scripts consumed outside loop)
**Charter tokens:** ~0.8 K
**type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (instrument — makes 5 gates portable but no chart-2 surface cell directly moves).
Real value: external workspaces can run `quay gate --gate <name>` with custom paths instead of
hardcoded experiment defaults. Completes the DIR-070 Gap 1 deliverable chain (Tier A in M137,
Tier B here).

## Scope

5 gate scripts need minor parameterization (CLI flags for experiment-coupled defaults) and
copy to `plugin/scripts/` with `.sh` wrappers:

1. `audit-independence-check.ts` — add `--orchestrator-env <name>` flag
2. `vmeta-lag-check.ts` — verify existing parameterization, add `--threshold <K>` flag
3. `it0-split-or-commit-check.ts` — add `--tasks-dir <dir>` flag
4. `it0-enforcement-with-design-check.ts` — verify existing `--root` parameterization
5. `it0-impl-row-check.sh` — make backlog file path a CLI argument

Then copy all 5 + wrappers to `plugin/scripts/`, update `.quay/config.yml` gate paths,
update `plugin-packaging.test.mjs`.

## Touches
- experiments/scripts/ (5 gate .ts files — parameterization)
- plugin/scripts/ (5 gates + wrappers)
- .quay/config.yml
- plugin/test/plugin-packaging.test.mjs

## Done-when (binary)

1. All 5 gates accept parameterized CLI flags with defaults maintaining backward compat.
2. All 5 gates + `.sh` wrappers exist in `plugin/scripts/`.
3. `.quay/config.yml` gate paths updated to `plugin/scripts/`.
4. `plugin-packaging.test.mjs` passes with no experiment leakage.
5. External workspace smoke: `quay gate --gate audit-independence --tasks-dir /tmp/test` works.

## Inner termination

Done-when-complete OR ΔV<0.02 K=2 OR budget ~10 AND NOT climbing OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
