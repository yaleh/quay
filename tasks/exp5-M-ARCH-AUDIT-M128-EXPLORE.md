---
id: exp5-M-ARCH-AUDIT-M128-EXPLORE
title: "M128 mandatory explore: post-M127 architecture audit (archguard L_D/L_G
  sweep, FILE-ONLY)"
status: done
labels:
  - milestone-candidate
  - explore
  - milestone:M-128
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Mandatory explore per ≥1/5 cadence rule. M124-M127 were 4 consecutive exploits since M123 explore reset. Fresh archguard architecture audit on master HEAD post-M127: re-measure entity/relation counts, outDegree metrics, cycle detection, god-packages. FILE-ONLY — file any new confirmed findings as milestone-candidates through routine-file-gate; no fixes.

M127 added 6 new scripts under experiments/quay-perpetual-stream/scripts/ — the packages/ entity graph should be unchanged, but the full-tree audit provides the periodic structural health reading.

## Plan

N/A — explore milestone. FILE-ONLY invariant (explore never fixes). Methodology-class — no quay-task-to-plan required; dispatch directly.

## Acceptance Criteria

- [ ] Fresh archguard analyze run on master HEAD (scope=packages/ or full-tree)
- [ ] Entity/relation counts recorded and compared vs M123 baseline (entities=144/relations=201/0 cycles)
- [ ] outDegree metrics for top functions recorded
- [ ] Cycle detection run (expect 0 cycles based on M123 baseline)
- [ ] Any new confirmed findings filed as milestone-candidates through routine-file-gate.ts
- [ ] FILE-ONLY: no source files modified (git diff --stat shows only the audit report + new finding tasks if any)

## Definition of Done

Standard inherited-core DoD clauses apply. Explore-class: adversarial-audit is a documented-no-op (FILE-ONLY — no deliverable to refute). DoD meta-enforcer applies.
- [ ] Archguard sweep completed and findings recorded in milestones/M128/iterations/iteration-0.md
- [ ] FILE-ONLY held: no packages/ or experiments/ scripts modified
- [ ] it0 DoD meta-enforcer passes