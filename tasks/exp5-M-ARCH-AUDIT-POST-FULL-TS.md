---
id: exp5-M-ARCH-AUDIT-POST-FULL-TS
title: "Architecture audit post-full-TS-migration: archguard L_D/L_G run on
  fully-migrated product"
status: done
labels:
  - milestone-candidate
  - explore
  - milestone:M-113
extra:
  schema: v1
---
## Proposal
Post-full-TS-migration mandatory explore. Run archguard on packages/ (all P3+P4 done), compare vs M108 baseline (121/156 entities/relations), record L_G/L_D metrics. Satisfies exp5-M-TS-MIGRATION AC4.

## Plan
N/A — methodology-class explore; no implementation. FILE-ONLY invariant: only new task files created, no product/method code changes.

## Acceptance Criteria
- [x] Fresh archguard analysis on master HEAD post-M112; entity/relation counts vs M108 baseline documented.
- [x] God-package + outDegree metrics re-measured; M108 expectations confirmed or deviations documented.
- [x] Any new genuine architectural findings filed as milestone-candidate tasks with reproduction evidence, gated through routine-file-gate.ts.
- [x] FILE-ONLY invariant held: git status shows only new task files, no code changes.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget, impl-row, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene, worktree-branch-hygiene, audit-independence — standard five clauses + task-specific extras).

- [x] Archguard re-run output pasted in Resolution; M108→M113 comparison table shows which metrics changed.
- [x] All new findings gated through routine-file-gate.ts (ACCEPT or REJECT documented for each); no finding filed without reproduction evidence.
- [x] FILE-ONLY confirmed: no commits to product/method code; only task files created (if any).
- [x] Resolution section populated with archguard data for AC4 citation.
- [x] it0 DoD meta-enforcer passes all clauses.

## Resolution

### Archguard run details

**Base commit:** c3607b05cdd02487436d302078a4a25ec4e015ba (master HEAD post-M112)
**Analysis command:**
```
node /home/yale/work/archguard/dist/cli/index.js analyze \
  --sources packages/quay/src --lang typescript --no-cache --format json \
  --work-dir /tmp/archguard-m113
```
**Generated:** 2026-07-22 (this session)

### M108 → M113 comparison table (AC4 evidence artifact)

| Metric | M108 baseline | M113 measurement | Delta | Status |
|--------|--------------|-----------------|-------|--------|
| Entities | 121 | 121 | 0 | UNCHANGED |
| Relations | 156 | 156 | 0 | UNCHANGED |
| Cycles | 0 | 0 | 0 | PASS |
| God-packages (archguard) | 0 | 0 | 0 | PASS |
| `loadWorkspaceGates` outDegree | 3 | 3 | 0 | CONFIRMED |
| `startServer` outDegree | 7 | 7 | 0 | CONFIRMED (WONTFIX) |
| `makeIt0Gate` outDegree | 6 | 6 | 0 | KNOWN (ARCH-M93-003) |
| High-coupling entities (≥8) | ProviderClient inDeg=9 | ProviderClient inDeg=9 | 0 | KNOWN |

### Top outDegree (M113, arch.json ground truth)

| Rank | Entity | outDegree | Notes |
|------|--------|-----------|-------|
| 1 | `serve.ts.startServer` | 7 | WONTFIX (ARCH-M103-002) |
| 2 | `gate/factories/it0.ts.makeIt0Gate` | 6 | Known inflation (type-only imports) |
| 3 | `adr-store.ts.createAdrStore` | 5 | Normal |
| 3 | `document-store.ts.createDocumentStore` | 5 | Normal |
| 3 | `gate/engine.ts.runGate` | 5 | Normal |
| 3 | `gate/factories/adr.ts.makeAdrGate` | 5 | Normal |
| 3 | `gate/factories/fixed-script.ts.makeFixedScriptGate` | 5 | Normal |
| 3 | `mcp-handlers.ts.registerLifecycleHandlers` | 5 | Normal |
| 3 | `provider-client.ts.connectProvider` | 5 | Normal |

### Findings assessment

No new findings to file. Analysis confirms the post-full-TS migration (`packages/quay/src`) is **structurally identical** to the M108 post-M105 baseline. The P3/P4 TS migrations (`mjs→ts`) changed file extensions only — they introduced no new structural entities, no new dependency edges, no new cycles, and no new god-packages. The `loadWorkspaceGates` outDegree=3 fix from M105 holds. The `startServer` WONTFIX baseline holds.

All existing ARCH tasks (`ARCH-M93-*`, `ARCH-M103-*`) are `done`. No open arch candidates on the board.

**routine-file-gate.ts invocations:** None required — no new genuine architectural findings identified. The dedup gate would also reject any re-filing of known findings.

### AC4 citation

This task constitutes the AC4 evidence artifact for `exp5-M-TS-MIGRATION`:
> "archguard runs on the migrated product and yields an L_G/L_D reading recorded on the dashboard"

Reading: entities=121, relations=156, no cycles, no god-packages, `loadWorkspaceGates` outDegree=3 — structural integrity confirmed post-full-TS-migration.
