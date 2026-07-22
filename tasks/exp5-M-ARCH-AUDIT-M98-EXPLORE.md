---
id: exp5-M-ARCH-AUDIT-M98-EXPLORE
title: "Post-M97 architecture audit (archguard, M98 mandatory explore):
  re-measure quay after startMcpServer decomposition + ABI boundary fix"
status: todo
labels:
  - milestone-candidate
  - milestone:M-98
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-ARCH-AUDIT-M98-EXPLORE
    experiments/quay-perpetual-stream/charters/M98-arch-audit-post-m97-explore.md
    /tmp/m98-absorb-entry.md
---
## Proposal
Mandatory explore at M98 (4 consecutive exploits M94–M97 since M93 explore). Re-run the full archguard architecture analysis on quay post-M97 structural changes:
- M95: ABI boundary fix (added exports map to quay/package.json; 4 import specifiers updated)
- M96: routine-file-gate self-reject fix (boardKeys excludePath param)
- M97: startMcpServer decomposition (808-line god-function → 187-line thin wrapper + 672-line mcp-handlers.ts)

**Scope:** Fresh archguard run against the current master HEAD. Measure:
1. Entity/relation counts vs M93 baseline (87 entities, 125 relations)
2. God-package analysis: gate/ fanOut/fanIn after the structural changes
3. God-function analysis: topByOutDegree — confirm startMcpServer drops from rank 1 (was outDegree=10); check startServer (ARCH-M93-003)
4. Cycle detection: confirm no new cycles introduced by mcp-handlers.ts
5. New findings: file any confirmed architectural defects/gaps as evidence-backed milestone-candidate tasks behind routine-file-gate

**Output:** Fresh ABSORB entry with archguard findings; any new filed tasks (FILE-ONLY: explore never fixes).

## Acceptance Criteria
- [ ] Fresh archguard analysis run on current master HEAD (post-M97); entity/relation counts updated vs M93 baseline.
- [ ] God-package + god-function metrics re-measured; startMcpServer outDegree confirmed ≤4 by archguard.
- [ ] Any new genuine architectural findings filed as milestone-candidate tasks with reproduction evidence.
- [ ] FILE-ONLY invariant held (explore never fixes what it finds).
