# M147 — Restore concurrent execution at correct layer

**Task:** DIR-092
**Milestone counter:** 147
**Chart:** 2
**Class:** methodology (governance-integrity — driver infrastructure)
**Value type:** governance-integrity
**Cadence:** exploit
**Deliverable:** no (driver infrastructure)
**Charter tokens:** ~0.5 K
**type:** learning

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (driver infrastructure). Real value: concurrent execution of touches-disjoint
execution-type milestones, reducing wall clock ~45% for N=2.

## Scope

Three files:

1. `execute-milestone.js` Land phase: restore IS_CONCURRENT guard.
   Concurrent mode → defers counter+dashboard, returns {touchedFiles, dashboardEntry}.
   Serial mode (default) → unchanged. Build stays inline (loop's fix preserved).

2. `OUTER-LOOP.md` step 1: restore batch assembly via `concurrent-batch-scheduler.ts`.

3. `OUTER-LOOP.md` step 4b: restore concurrent dispatch from MAIN session + fan-in.

## Touches
- .claude/workflows/execute-milestone.js
- experiments/quay-perpetual-stream/OUTER-LOOP.md

## Done-when (binary)

1. IS_CONCURRENT guard restored. Build stays inline.
2. OUTER-LOOP step 1 batch assembly restored.
3. OUTER-LOOP step 4b concurrent dispatch + fan-in restored.
4. Serial path (1-wide) unchanged.

## Inner termination

Done-when-complete OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
