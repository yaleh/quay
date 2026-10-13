---
id: gap-discovery-toolchain-depends-on-unshipped-docs-analysis-and-ts-sources-never-works-off-quay-repo
title: "all 3 discovery routines
  (open-semantic-discovery/discovery-method/arch-discovery) resolve
  docs/analysis/*.mjs, which is not shipped in the plugin artifact and itself
  transitively imports plugin/scripts/*.ts SOURCE files — confirmed on 0.19.0
  cache and a fresh develop build: no host project other than quay's own live
  checkout has ever produced a discovery round"
status: todo
labels:
  - gap
  - defect
  - discovery-method
  - packaging
parent: null
children: []
extra: {}
---
## Proposal
**Discovered 2026-10-13 while enabling `open_semantic_discovery` on ClaudeCodeUI (first-ever deployment outside quay's own dev checkout).** All three semantic/architecture discovery routines (`open-semantic-discovery-routine.ts`, `discovery-method-routine.ts`, `arch-discovery-routine.ts`) resolve their engine modules from `docs/analysis/*.mjs` (`resolveEngineModule`, `open-semantic-discovery-routine.ts:1358`: tries `<kernel-root>/docs/analysis/<file>` then `<project-root>/docs/analysis/<file>`). **`docs/analysis/` is not part of the shipped plugin artifact** — confirmed by direct inspection of two real builds:
- the currently-installed cache `~/.claude/plugins/cache/quay/quay/0.19.0/` has no `docs/` directory at all (and that version predates this routine's code, so it was never reachable even in principle);
- a fresh build of develop via the project's own `build-plugin-dist.mjs` (the private 0.20.0-dev trial build) also produces no `docs/` directory.

A conservative, additive-only workaround was applied to the TRIAL build only (`/data/home/yale/work/quay-scratch/private-dist-020-dev/docs/analysis/*` + `plugin/scripts/*.ts`, copied from quay's own checkout, never touching claudecodeui's business code or quay's own repo) and the dependency chain still does not resolve cleanly:

1. `arch-hypothesis-generation.mjs` imports a SIBLING `docs/analysis/architecture-evidence-store.mjs` — none of the 4 modules `loadOpenDiscoveryModules` needs are self-contained; the real dependency graph is wider than its own 4-file list.
2. Copying the WHOLE `docs/analysis/` directory (131 files) still fails: `arch-hypothesis-generation.mjs` then imports `plugin/scripts/import-graph-check.ts` — a TypeScript SOURCE file, not a compiled `scripts/dist/*.js` file. **The discovery toolchain under `docs/analysis/` is written to run against a live quay SOURCE checkout (where `plugin/scripts/*.ts` sits beside `docs/analysis/`), not against a built plugin artifact that ships only `scripts/dist/*.js`.**
3. Copying `plugin/scripts/*.ts` (288 files) wholesale still does not cleanly resolve (a module-level initialization error appeared, likely a missing runtime context the live quay repo normally supplies — e.g. an env var, a relative resource, or additional source subdirectories not yet copied) — not fully diagnosed, left for this task.

**Consequence:** `open_semantic_discovery` (and by the same code shape, `discovery_method` and `arch_discovery`) can be ENABLED (config accepted, routine assembled, log line printed) in ANY host project's `.quay/config.yml`, but the round itself fails `engine modules unresolved` every time, for EVERY project using the normal, officially-distributed plugin install — this is not specific to ClaudeCodeUI or to this trial's private build; it would reproduce identically on quay-fleet, archguard, cantus, meta-cc, or any future host, with any officially-released plugin version that includes this code. **This is why no host project other than quay's own live dev checkout has ever produced a single discovery round, independent of whether its config declares the section.**

## Plan
1. **Decide the fix shape from evidence, not a guess**, between (at least) these two:
   - (a) make the plugin build ship the full transitive closure the discovery toolchain needs (`docs/analysis/*` + whatever of `plugin/scripts/*` it imports) as part of the normal dist artifact — bounded by actually walking the import graph (reuse `import-graph-check.ts`'s own capability, since that is literally one of the things that needs shipping) rather than copying everything;
   - (b) refactor the discovery toolchain so it depends only on the SAME compiled kernel surface every other shipped routine already uses (`scripts/dist/*.js` exports), removing the live-source-checkout assumption at the root.
   (b) is architecturally cleaner (no more "this code only works in quay's own repo" asymmetry) but is a larger refactor; (a) is a smaller, bounded packaging fix. State which was chosen and why, with the import-graph evidence from THIS task's own investigation (not reused from the trial's informal file-copy attempts).
2. Whichever shape, the acceptance proof must be a FRESH plugin build (via the project's own `build-plugin-dist.mjs`, not a hand-copied scratch tree) that runs a real `open_semantic_discovery` round to completion against a project OTHER than quay's own repo.

## Acceptance Criteria
- [ ] AC1: the full import graph `docs/analysis/*.mjs` (as used by the three discovery routines) actually needs, computed mechanically (not asserted), is pasted — file count and whether any of it is itself a `.ts` source file.
- [ ] AC2: the decision ((a) ship the closure / (b) refactor off source-file dependence) is stated with the evidence basis.
- [ ] AC3: a FRESH `build-plugin-dist.mjs` run produces an artifact that, installed into a scratch project with NO quay source checkout alongside it, runs `open_semantic_discovery --once --root <scratch>` to a real `scan-round` record (not a RED/failed one) in that scratch project's own carrier. Paste the command and the carrier line.
- [ ] AC4: the SAME artifact still fails cleanly (not a crash) when a project root is genuinely empty of the project's own code, with a NOT-EVALUATED-shaped reason (hard rule 3b) — negative control.
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence.
- The fix is proven on a FRESH official-shaped build, not on the ad-hoc scratch copy this finding was discovered through.

## Touches
- tasks/gap-discovery-toolchain-depends-on-unshipped-docs-analysis-and-ts-sources-never-works-off-quay-repo.md
- packages/quay/scripts/build-plugin-dist.mjs
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/discovery-method-routine.ts
- plugin/scripts/arch-discovery-routine.ts
- docs/analysis/arch-hypothesis-generation.mjs
