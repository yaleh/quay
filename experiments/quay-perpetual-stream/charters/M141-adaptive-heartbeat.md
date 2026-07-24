# M141 — Adaptive Build-phase heartbeat

**Task:** DIR-078
**Milestone counter:** 141
**Chart:** 2
**Class:** methodology (instrument-correction)
**Value type:** instrument-correction
**Cadence:** exploit
**Deliverable:** no (loop's own coordination machinery)
**Charter tokens:** ~0.5 K
**type:** learning

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (coordination infrastructure). Real value: ~35-50 min/session wasted on
fixed ScheduleWakeup polling during Build phase. After DIR-074, the harness notification
is the primary wake; ScheduleWakeup becomes a hang-detection backstop only.

## Scope

One file change:

1. `execute-milestone.js` Build phase: adaptive fallback interval by charter scope
   (small=300s, medium=600s, large=1200s). Remove ScheduleWakeup polling loop;
   harness notification is exclusive primary wake.

## Touches
- .claude/workflows/execute-milestone.js

## Done-when (binary)

1. Hang-detection fallback interval scales by charter scope.
2. Single backstop, not a polling cadence.
3. Build duration recorded in iteration evidence.

## Inner termination

Done-when-complete (3 clauses) OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
