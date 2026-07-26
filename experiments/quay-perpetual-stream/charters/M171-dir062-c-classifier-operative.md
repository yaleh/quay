# M171 — Prove classifier operative on real tasks (DIR-062-C)

**Task:** DIR-062-C · **Counter:** 171 · **Chart:** 2
**Class:** development · **Value type:** governance-integrity
**Deliverable:** yes · **Charter tokens:** ~0.5 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0. Exercises the classifier on real board tasks to produce durable classification evidence, and verifies that select-preflight.ts actually invokes the classifier (closing the DIR-062-B audit finding).

## Scope
1. Run human-steered-classify.ts against real board tasks (driver-editing, non-driver, cross-workspace cases)
2. Verify select-preflight.ts calls the classifier (not just label:human-steered string match). If it doesn't, fix it.
3. Record classification evidence in a durable artifact

## Touches
- .claude/workflows/select-preflight.js (if fix needed)
- experiments/quay-perpetual-stream/scripts/select-preflight.ts (if fix needed)

## Done-when
1. Classifier produces correct verdicts on 3 real cases (driver-edit → true, non-driver → false, cross-workspace → true)
2. select-preflight.ts invokes human-steered-classify.ts instead of only checking label:human-steered
3. select-preflight.js (compiled/derived from .ts) reflects the classifier call
4. Existing select-preflight self-tests stay green
5. All driver selfchecks + fixtures stay green

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
