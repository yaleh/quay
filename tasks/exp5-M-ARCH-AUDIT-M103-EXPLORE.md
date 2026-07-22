---
id: exp5-M-ARCH-AUDIT-M103-EXPLORE
title: "Post-M101 architecture audit (archguard, M103 mandatory explore):
  re-measure quay after serve.ts decomposition + gate/registry factory split"
status: todo
labels:
  - milestone-candidate
  - milestone:M-103
parent: null
children: []
extra: {}
---

## Finding

Mandatory explore at M103 (4 consecutive exploits M99–M102 since M98 explore; ≥1/5 rule fires).

**Structural changes since M98 baseline:**
- M99: `registerAllHandlers()` facade — `startMcpServer` outDegree 7→3
- M100: `serve.ts` 1085L→101L; `serve-handlers.ts` new (1068L); `startServer` body 675L→65L
- M101: `gate/registry.ts` 736L→118L; `gate/factories/` directory (10 new files)

**What to measure:**
- Entity/relation counts vs M98 baseline (~92 entities, ~131 relations)
- `topByOutDegree` — `startServer`, `startMcpServer` rank after decomposition
- gate/ package metrics: fanOut=62 expected unchanged (intra-package); per-file entityCount should drop for registry.ts
- New god-packages: `serve-handlers.ts` (1068L) + `gate/factories/` may create new concentration
- Cycles: none expected but must verify

## Acceptance Criteria

- [ ] Fresh archguard analysis run on current master HEAD (post-M101); entity/relation counts updated vs M98 baseline.
- [ ] God-package + god-function metrics re-measured; `startServer` and `startMcpServer` outDegree confirmed.
- [ ] Any new genuine architectural findings filed as milestone-candidate tasks with `## Finding` + reproduction evidence, gated through `routine-file-gate.mjs`.
- [ ] FILE-ONLY invariant held: `git status --porcelain` shows only new task files, no code changes.

## Definition of Done

- [ ] Archguard re-run output pasted in ABSORB entry; M98→M103 comparison table shows which metrics changed.
- [ ] All new findings gated through `routine-file-gate.mjs`; no finding filed without reproduction evidence.
- [ ] FILE-ONLY confirmed.
- [ ] it0 DoD meta-enforcer passes all clauses.
