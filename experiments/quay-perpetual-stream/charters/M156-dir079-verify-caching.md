# M156 — Per-it0-check incremental caching in Verify phase

**Task:** DIR-079 · **Counter:** 156 · **Chart:** 2
**Class:** methodology · **Value type:** instrument-correction
**Deliverable:** no · **Charter tokens:** ~0.3 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

## Value hypothesis

Δv̂ = 0. Reduces wasted agent execution in Verify phase by caching per-check results keyed on input fingerprints. Observed in session b643aa4d: 5 retries, each re-running 4 already-passing checks.

## Scope

Add per-check input fingerprinting to execute-milestone.js Verify phase. Cache results by {phase, label, fingerprint}. Skip re-running checks whose inputs haven't changed.

## Touches
- .claude/workflows/execute-milestone.js (add per-check caching to Verify phase)

## Done-when (binary)

1. Verify phase computes per-check input fingerprints before dispatching.
2. Checks with matching fingerprint + prior PASS/FAIL are skipped (cache hit).
3. Checks with changed/missing fingerprint dispatch normally.
4. Existing selfchecks/fixtures stay green.

## Inner termination

Done-when-complete OR external HALT.

## Pointer

inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
