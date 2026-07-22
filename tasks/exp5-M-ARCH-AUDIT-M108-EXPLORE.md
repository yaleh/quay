---
id: exp5-M-ARCH-AUDIT-M108-EXPLORE
title: "Post-M105 architecture audit (archguard, M108 mandatory explore):
  re-measure quay after loadWorkspaceGates refactor + gateFactories dispatch
  map"
status: todo
labels:
  - milestone-candidate
parent: null
children: []
extra: {}
---

## Finding

Mandatory explore at M108 (4 consecutive exploits M104–M107 since M103 explore; ≥1/5 rule fires).

**Structural changes since M103 baseline:**
- M104: ARCH-M103-002 WONTFIX — `startServer` outDegree=7 documented as correct post-M100 baseline (handleAllRoutes edge inherent)
- M105: ARCH-M103-001 fix — `loadWorkspaceGates` outDegree 8→3; `gateFactories` dispatch map added to `gate/factories/index.ts`
- M106/M107: TS migration P4 Batches 1+2 — 16 method-infra scripts `.mjs→.ts`; no product code (`packages/`) touched

**What to measure:**
- Entity/relation counts vs M103 baseline
- `loadWorkspaceGates` outDegree (should be ~3 post-M105; confirm ≤4 threshold met)
- `startServer` outDegree (should be 7, per M104 WONTFIX; confirm unchanged)
- `gate/factories/index.ts` new barrel — outDegree and fanIn metrics
- Any new god-packages/god-functions introduced by M105's structural reorganization
- Cycles: none expected but must verify

## Acceptance Criteria

- [ ] Fresh archguard analysis run on current master HEAD (post-M107); entity/relation counts updated vs M103 baseline.
- [ ] God-package + god-function metrics re-measured; `loadWorkspaceGates` and `startServer` outDegree confirmed.
- [ ] Any new genuine architectural findings filed as milestone-candidate tasks with `## Finding` + reproduction evidence, gated through `routine-file-gate.ts`.
- [ ] FILE-ONLY invariant held: `git status --porcelain` shows only new task files, no code changes.

## Definition of Done

Standard inherited-core DoD clauses apply. Task-specific criteria:

- [ ] Archguard re-run output pasted in ABSORB entry; M103→M108 comparison table shows which metrics changed.
- [ ] All new findings gated through `routine-file-gate.ts` (ACCEPT or REJECT documented for each); no finding filed without reproduction evidence.
- [ ] FILE-ONLY confirmed: no commits to product/method code; only task files created (if any).
- [ ] it0 DoD meta-enforcer passes all clauses.

## Proposal

N/A — methodology-class explore; no implementation.

## Plan

N/A — explore class; FILE-ONLY. No plan required.
