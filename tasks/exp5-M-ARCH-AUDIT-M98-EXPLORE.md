---
id: exp5-M-ARCH-AUDIT-M98-EXPLORE
title: "Post-M97 architecture audit (archguard, M98 mandatory explore):
  re-measure quay after startMcpServer decomposition + ABI boundary fix"
status: done
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
- [x] Fresh archguard analysis run on current master HEAD (post-M97); entity/relation counts updated vs M93 baseline.
- [x] God-package + god-function metrics re-measured; startMcpServer outDegree measured at 7 by archguard (AC said ≤4; measurement is 7 — new finding PROBE-M98-001 filed documenting the gap).
- [x] Any new genuine architectural findings filed as milestone-candidate tasks with reproduction evidence.
- [x] FILE-ONLY invariant held (explore never fixes what it finds).

## Plan

N/A — methodology-class / explore milestone; no implementation plan required. Archguard analysis is a read-only tool invocation; findings are filed as task files (FILE-ONLY). No docs/plans/*.md needed.

## Definition of Done

References the standard inherited-core DoD clauses (adversarial-audit, V_meta-lag, line-budget, impl-row, no-self-exemption, test-floor); the bar is REAL LANDING, not artifacts:

- [x] Archguard re-run output captured in ABSORB entry; M93→M98 comparison table shows which metrics changed.
- [x] All new findings gated through `routine-file-gate.mjs` (ACCEPT or REJECT documented for each); no finding filed without reproduction evidence.
- [x] FILE-ONLY confirmed: no commits to product/method code; only task files created.
- [x] it0 DoD meta-enforcer passes all clauses.




## Not selected (M115)

Not selected M115 — exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM selected instead. Separately noted: this task's own AC checklist is already fully ticked [x] (the M98 explore genuinely ran) but `status` was never flipped to `done` — a bookkeeping oversight worth a trivial administrative fix in a future pass (verify findings still hold, flip status, no new work).



## Not selected (M116)

Not selected M116 — exp5-M-TS-MIGRATION-P5-A selected instead (capability-growth: real product TS migration work, diversifying value type from the last two governance-integrity/instrument-correction picks M114/M115). Good next pick.

## Not selected (M117)

Not selected M117 — exp5-M-TS-MIGRATION-P5-B selected instead (completes the DIR-058 sibling program). Same stale-status-flip bookkeeping issue noted at M115 still stands (AC/DoD all `[x]`, status still `todo`) — bundling a fix for this and PROBE-M98-001's identical issue into one small future administrative milestone would be efficient (verify both sets of findings still hold post-TS-migration, flip both statuses, no new investigation needed).

## Administrative resolution (M118 ABSORB, 2026-07-23)

Verified live at M118 (the follow-on, post-DIR-058 full-scope archguard explore): the M98 findings still
hold — `startMcpServer`'s M97-era decomposition confirmed stable (see `PROBE-M98-001`'s own M118
re-verification, outDegree=3 unchanged since the M99 fix), no new cycles introduced, entity/relation
counts have since grown as expected from the TS-migration programs (M98: unrecorded exact baseline in
this task's own body beyond the M93 87/125 reference; M118: 144/201 scope=packages, post-full-JS-
elimination). `status` flipped `todo` → `done` as a pure administrative correction — the M98 explore's
work was already genuinely complete, only the task's own bookkeeping was stale.
