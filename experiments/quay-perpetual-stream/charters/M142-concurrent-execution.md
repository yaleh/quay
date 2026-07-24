# M142 — Wire concurrent multi-milestone execution into exp5

**Task:** DIR-075
**Milestone counter:** 142
**Chart:** 2
**Class:** methodology (governance-integrity — driver infrastructure)
**Value type:** governance-integrity
**Cadence:** exploit
**Deliverable:** no (loop's own driver machinery)
**Charter tokens:** ~1.0 K
**type:** learning

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (driver infrastructure). Real value: when 2+ execution-type milestones are
touches-disjoint, they run concurrently — wall clock drops from ~240 min (serial)
to ~130 min (~45% reduction for N=2).

## Scope

Three file changes + one new file:

1. `.quay/loop.yml` — create with concurrency:4
2. `OUTER-LOOP.md` step 1 — wire `concurrent-batch-scheduler.ts` into SELECT
3. `OUTER-LOOP.md` step 4 — concurrent dispatch + fan-in absorb
4. `execute-milestone.js` Land phase — defer shared-state writes in concurrent mode

## Touches
- .quay/loop.yml
- experiments/quay-perpetual-stream/OUTER-LOOP.md
- .claude/workflows/execute-milestone.js

## Done-when (binary)

1. `.quay/loop.yml` exists with concurrency:4.
2. OUTER-LOOP.md step 1 calls concurrent-batch-scheduler.ts to assemble batch.
3. OUTER-LOOP.md step 4 dispatches N concurrent execute-milestone workflows.
4. execute-milestone.js Land phase supports mode:"concurrent" (defers counter+dashboard).
5. Serial path (1-wide batch) preserved unchanged — backward-compatible.

## Inner termination

Done-when-complete (5 clauses) OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
