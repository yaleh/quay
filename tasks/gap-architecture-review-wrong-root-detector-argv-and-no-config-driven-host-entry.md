---
id: gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry
title: architecture-review 无 config.yml host 入口 + 三检测器 argv 解析到目标仓根（非
  kernel）两处结构性不可部署缺陷
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal
**Part of the approved "Quay architecture analysis as a shipped capability" consolidation (2026-10-13) — the host-deployability half, parallel to what `gap-discovery-toolchain-depends-on-unshipped-docs-analysis-and-ts-sources-never-works-off-quay-repo` (Task D, landed `b9ca7a9e2`) fixed for the three discovery routines. `architecture-review` has TWO separate, confirmed structural gaps that Task D did not touch (it is a different routine, not covered by that fix):**

**Gap 1 — no `.quay/config.yml`-driven host entry.** Every sibling Layer-1b routine (`open_semantic_discovery`, `discovery_method`, `arch_discovery`, `cross_project_dogfood`) is assembled from a `loop.<name>:` config block via its own `read<Name>Config(rootDir)` function (confirmed: `readDiscoveryMethodConfig` imported at `quality-gate-driver.ts:112`; `arch_discovery`/`cross_project_dogfood` have parallel reads). `architecture-review`'s cadence (`archReviewIntervalMinutes`) has NO such function — it is set ONLY by the CLI flag `--arch-review-interval` (`quality-gate-driver.ts:1300,1341,1371`), falling back to the hardcoded `ARCH_REVIEW_INTERVAL_MIN_DEFAULT = 60` (`:142`) when absent (`:1404-1405`). Confirmed by grep: zero occurrences of `architecture_review` anywhere in `plugin/scripts/*.ts`, `plugin/test/*.mjs`, or this repo's own `.quay/config.yml` — the key is entirely unclaimed. A host cannot enable/disable/schedule/cap this routine the way it can every other one; it can only be driven by whatever CLI invocation launches the anchor (not an operator-editable, per-project setting).

**Gap 2 — the three mechanical detectors resolve to the TARGET workspace, not the kernel.** `defaultIdentityReplicationArgv`/`defaultGuardLineageArgv`/`defaultDeletionClosureArgv` (`quality-gate-driver.ts:619-640`) each build their spawn path as `path.join(root, "plugin", "scripts", "<name>.ts")`, with an explicit code comment on every one: `// kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.` `root` here is the TARGET project's workspace root (the project being analyzed), not quay's own kernel/plugin install. This is correct ONLY when `root` happens to BE quay's own live dev checkout — on any other host (an installed plugin with no `plugin/scripts/identity-replication-check.ts` under its OWN project root), every detector spawn fails closed with a spawn error, and `runArchitectureReview` returns `not-evaluated: identity-replication spawn error: ...` every round, forever. This is structurally the SAME class of defect Task D fixed (a mechanism that only works off quay's own repo), but a DIFFERENT specific cause (wrong root resolution, not an unshipped dependency) and a DIFFERENT file (`quality-gate-driver.ts`, not `build-plugin-dist.mjs`) — not covered by Task D's fix or its tests.

**The fix for Gap 2 already exists and is used elsewhere in this exact codebase** — `resolveKernelScriptsDir()` (`plugin/scripts/driver-runtime.ts:302`, `QUAY_PLUGIN_ROOT`-overridable, hermetic-test seam) is the established pattern for "resolve a sibling kernel script's path regardless of which workspace is being analyzed," already used by `worker-fan-in.ts` (`:43,335,342,2097,3092`), `worker-driver.ts` (`:246`), and `promotion-driver.ts` (`:176`, resolving `ready-pool-check.ts` the identical way). `architecture-review`'s three detector-argv builders are the one place in the codebase that does NOT use it.

Confirmed NOT already covered by any existing task: `grep -li architecture-review tasks/*.md` returns 19 files, all either `done` (and about unrelated gaps — gap-filing routing, detector flag predicates, identity/deletion counting bugs, pool-judge spawnSync timeout for the UNRELATED B15 `pool-quality-judge` routine) or about cross-project-dogfood (also unrelated). None address config-entry or root-resolution.

## Plan
1. Add `readArchitectureReviewConfig(rootDir)` mirroring the existing `read<Name>Config` shape used by `discovery_method`/`arch_discovery`/`cross_project_dogfood` (enabled / interval / any caps worth exposing — at minimum the interval, since that's the only thing currently configurable at all, via CLI flag). Wire it into the same assembly point as the siblings (log line + injection into `qualityGateRoutines(...)`), replacing the CLI-flag-only resolution. Keep the CLI flag as a documented override, same precedence rule used elsewhere (`QUAY_PLUGIN_ROOT`-style: explicit arg wins, config next, hardcoded default last) — do not remove it outright without checking for a consumer (hard rule 5/5b: check for other call sites before deleting).
2. Fix `defaultIdentityReplicationArgv`/`defaultGuardLineageArgv`/`defaultDeletionClosureArgv` to resolve the detector script path via `resolveKernelScriptsDir()` instead of `path.join(root, "plugin", "scripts", ...)`. Remove the now-inaccurate `kernel-sibling-dev-tree-only` comment on each (it will no longer be true). `root` continues to be passed as the `--root` arg to each detector (that part is correct — it's what the detector analyzes, not where the detector's own code lives).
3. Negative control: verify, pre-fix, that running `runArchitectureReview` with `root` pointed at a clean scratch directory with no `plugin/scripts/*.ts` of its own produces exactly the `not-evaluated: identity-replication spawn error` failure described above (hard rule 2's "run the predicate against a known-true sample" half) — then verify, post-fix, the same scratch root produces a real detector run (using the KERNEL's own detector scripts analyzing the scratch root's — likely trivial/empty — dependency graph).
4. No change to detector semantics, trigger computation, judge call, or gap-filing wiring — this task is scoped to deployability (config entry + root resolution) only.

## Acceptance Criteria
- [ ] AC1: `readArchitectureReviewConfig` exists, follows the same shape/precedence as a sibling `read<Name>Config`, and is wired into the same assembly log-line pattern (`quality-gate-driver: architecture-review 例程已装配...`) as `cross_project_dogfood`/`discovery_method`. A `.quay/config.yml` with `loop.architecture_review: {enabled: false}` produces zero spawns for a round that would otherwise have fired (pasted before/after).
- [ ] AC2: the negative control from Plan step 3 is pasted — pre-fix run against a clean scratch root (no `plugin/scripts/*.ts`) fails exactly as predicted (`identity-replication spawn error`), proving the defect is real before claiming a fix.
- [ ] AC3: post-fix, the SAME clean scratch root (still no `plugin/scripts/*.ts` of its own) produces a real, non-error detector run via `resolveKernelScriptsDir()` resolving to the KERNEL's own `plugin/scripts/identity-replication-check.ts` — pasted stdout/exit code.
- [ ] AC4: this repo's own existing behavior is unchanged (`root` == kernel's own checkout continues to resolve identically, since `resolveKernelScriptsDir()` without `QUAY_PLUGIN_ROOT` override resolves to the running kernel's own scripts dir, which in this repo's dev-loop case is itself) — pasted a real round's identity-replication output before/after this change, byte-identical modulo path prefix.
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence. No change to detector trigger logic, judge call behavior, or the already-landed gap-filing wiring (`gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-channel`).
- `ARCH_REVIEW_INTERVAL_MIN_DEFAULT` and the CLI flag both continue to work as documented fallbacks; config takes precedence when present (checked against the precedence table of a sibling routine's existing test).

## Touches
- tasks/gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/quality-gate-driver.test.mjs
