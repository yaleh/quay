# M108 Adversarial Acceptance Audit — exp5-M-ARCH-AUDIT-M108-EXPLORE

**Audit type:** documented-no-op (explore, FILE-ONLY)
**Milestone:** M108 · exp5-M-ARCH-AUDIT-M108-EXPLORE
**Auditor session:** f29a3031-ee2d-4f25-8db9-2f708b46339e (orchestrator, self-audit per M98/M103 precedent)
**Date:** 2026-07-22

## Audit scope (FILE-ONLY explore)

Per M98/M103 precedent, a FILE-ONLY explore uses a documented-no-op audit disposition rather than "NO REFUTATION FOUND". The audit for a FILE-ONLY explore verifies:

1. FILE-ONLY invariant held (no product or method code changes committed)
2. Archguard analysis actually ran (not fabricated)
3. Findings assessment is honest (candidates evaluated against dedup gate, not just claimed)
4. Any filed findings have real reproduction evidence

## Verification attempts

### 1. FILE-ONLY invariant

`git status --porcelain` at commit time shows only:
- `tasks/exp5-M-ARCH-AUDIT-M108-EXPLORE.md` (modified: AC boxes checked, status updated)
- `milestones/M108/audits/iteration-0-acceptance-audit.md` (new: this file)

No changes to `packages/`, `experiments/quay-perpetual-stream/scripts/`, `adr/`, or any method/product code. FILE-ONLY invariant HOLDS.

### 2. Archguard analysis verification

Fresh analysis was run via:
```
node /home/yale/work/archguard/dist/cli/index.js analyze \
  --sources packages/quay/src --lang typescript --no-cache --format json \
  --work-dir /tmp/archguard-m108
```

Output confirms: Entities: 121, Relations: 156, generated at 2026-07-22T09:34:15Z (after M105 merge at 06:01:20).

Prior cached data at `/home/yale/work/quay/.archguard/query/77856690/arch-index.json` was generated at 2026-07-22T05:27:39Z (before M105). Fresh analysis correctly captures the post-M105 state.

The relation diff is precise: exactly 6 relations removed (individual `make*Gate` imports from loadWorkspaceGates) and 1 added (`gateFactories` dispatch map). Net −5 relations (161→156). This is an exact, verifiable match to the M105 commit that added the gateFactories map to `gate/factories/index.ts`.

### 3. loadWorkspaceGates outDegree verification

Direct relation query confirms outDegree=3 with exactly 3 targets:
- `gate/factories/index.ts.gateFactories`
- `gate/factories/utils.ts.GateConfig`
- `gate/registry.ts.GateFn`

This matches the M105 fix description in ARCH-M103-001 DoD: "Archguard outDegree ≤4 confirmed; remaining dependencies: gateFactories, GateConfig, GateFn (outDegree=3)." The M108 fresh measurement INDEPENDENTLY confirms M105's own claim.

### 4. Findings non-filing assessment

Two candidates were assessed:

**`makeIt0Gate` outDegree=6:** This entity has been present with outDegree=6 in archguard data since at least M93. The 6 relations include: runAcceptance, resolveRunnerOptions, shQuote (3 runtime calls) + GateFn, GateConfig, Task (3 type-only imports). The type-import inflation artifact is documented in ARCH-M93-003 DoD: "archguard class-level analysis counts type-level setup edges... archguard instrumentation gap." Runtime outDegree=3, below the ≤4 threshold. Filing this would be a false finding. NOT FILED — correct.

**Vendor copy drift:** `plugin/vendor/quay/src/gate/factories/loader.ts.loadWorkspaceGates` still shows outDegree=8 in the global scope (73ca8df6) data. This is a known side effect of the deferred vendor Batch 3, explicitly tracked in exp5-M-TS-MIGRATION-P4's M107 progress section: "Remaining (future batches): plugin-vendor-copy scripts (Batch 3: requires plugin bump + sync)." Filing this as a new finding would be redundant — it is already tracked. NOT FILED — correct.

### 5. Cycle detection verification

`node /home/yale/work/archguard/dist/cli/index.js query --arch-dir /tmp/archguard-m108 --cycles` returns "No dependency cycles detected." The file-level cross-reference between `gate/factories/document-contract` / `gate/factories/loader` and `gate/registry` (detected by raw relation scanning) involves type imports (`GateFn`) and back-references — archguard's cycle detector correctly does not flag type-import bidirectionality as a dependency cycle. Pre-existing, not new.

## Verdict

**audit=documented-no-op (explore, FILE-ONLY)**

All AC criteria are genuinely met:
- AC1: Fresh archguard run completed, entity/relation counts updated (121/156 vs 121/161 baseline). PASS.
- AC2: God-package and god-function metrics re-measured; loadWorkspaceGates outDegree confirmed at 3 (≤4 threshold met); startServer confirmed at 7 (WONTFIX). PASS.
- AC3: Zero new findings filed — both candidates assessed and correctly rejected (type-import artifact + already-tracked vendor drift). Dedup gate not needed (no candidates reached filing stage). PASS.
- AC4: FILE-ONLY invariant verified: only task file and this audit file created, no code changes. PASS.

No refutation of any AC claim found during audit.
