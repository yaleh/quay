# M137 — drain-scheduler + /drain-directives workflow

**Milestone counter:** 137
**Chart:** 2
**Class:** methodology (governance-integrity — mechanizes loop step)
**Value type:** governance-integrity
**Cadence:** exploit (streak=2/4)
**Deliverable:** no (loop machinery — DRAIN step)
**Charter tokens:** ~0.8 K

## Value hypothesis

Δv̂ = 0 (governance-integrity, no chart-2 cell movement). Real value: preventing the exact DRAIN-skip failure observed at the previous boundary
(two directives missed because step 0 was skipped — see drain-before-select memory).

**Metric Y:** `/drain-directives` workflow exits 0 with `{drained: N}` on a board
with pending directives; exits with `{drained: 0}` on a clean board.

## Scope

1. `drain-scheduler.ts` — pure script reading directive list, classifies each as
   autonomous/human-steered, exits 0 (due) or 3 (none).
2. `/drain-directives` workflow — Schedule→Dispose→Verify phases.
3. OUTER-LOOP.md step 0 reduced to workflow invocation pointer.
4. Step 1 gains DRAIN-must-complete precondition.

## Done-when

1. `drain-scheduler.ts` exists, exits 0 on pending directives, 3 on empty.
2. `/drain-directives` workflow runs deterministically.
3. OUTER-LOOP.md step 0 ≤ 3 lines.
4. Step 1 SELECT enforces DRAIN precondition.

## Inner termination

Done-when-complete OR external HALT.

## it0 checks

**In-scope gap subset:** none (new directive, not in exp4 gap-list).

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93
