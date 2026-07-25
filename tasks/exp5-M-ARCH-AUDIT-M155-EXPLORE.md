---
id: exp5-M-ARCH-AUDIT-M155-EXPLORE
title: exp5-M-ARCH-AUDIT-M155-EXPLORE — architecture audit explore
  (cadence-forced, M128+27)
status: todo
labels:
  - milestone-candidate
  - explore
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-ARCH-AUDIT-M155-EXPLORE experiments/quay-perpetual-stream/charters/M155-arch-audit-explore.md /tmp/m155-absorb-entry.md
---
## Proposal

Autonomous architecture audit explore milestone. Run archguard static analysis on packages/quay to discover new structural gaps, dependency issues, god-packages, or duplicated abstractions. Compare against last explore (M133 — 144/201/0 cycles, identical to M128). File evidence-backed candidates for any NEW findings.

## Plan

N/A — no docs/plans/*.md reference (explore milestone; the inline steps below are the complete spec).

1. Run archguard `get_package_stats` on the current codebase
2. Run archguard `get_arch_metrics` for cycle detection
3. Compare results against M133 baseline (144 packages, 201 dependencies, 0 cycles)
4. For any NEW finding (new cycle, new god-package, new structural regression): file a milestone-candidate task with evidence
5. Write findings to milestones/M155/iterations/iteration-0.md
6. If no new findings (identical to M133): document as no-op explore, CONTINUE

## Acceptance Criteria

- [ ] archguard analysis runs successfully on current codebase
- [ ] Results compared against M133 baseline
- [ ] Any new structural findings filed as milestone-candidate tasks
- [ ] Iteration report written with pasted archguard output

## Definition of Done

Per inherited-core.md standard DoD clauses (0-12). Applicable: 0, 1, 3, 5, 10, 11. Clauses 2/4/6/7/8/9/12 are N/A for explore (FILE-ONLY) milestones.

- [ ] archguard analysis completed and documented
- [ ] Comparison against M133 baseline documented
- [ ] New candidates filed (if any) OR documented no-op
- [ ] Iteration report committed

## Touches

- milestones/M155/ (new — iteration reports and audit artifacts ONLY)
- tasks/ (new milestone-candidate tasks ONLY if findings discovered)