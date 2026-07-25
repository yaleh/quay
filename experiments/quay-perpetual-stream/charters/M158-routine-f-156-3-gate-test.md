# M158 — Create missing test file for gate-script-base.ts

**Task:** exp5-M-ROUTINE-F-156-3 · **Counter:** 158 · **Chart:** 2
**Class:** methodology · **Value type:** instrument-correction
**Deliverable:** no · **Charter tokens:** ~0.2 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0. Closes ADR-001 test coverage gap. gate-script-base.ts (M152) is load-bearing but has no sibling test file, causing permanent ADR-001 gate failure.

## Scope

Create gate-script-base.test.mjs with unit tests for all exported functions.

## Touches
- experiments/quay-perpetual-stream/test/gate-script-base.test.mjs (new)

## Done-when (binary)

1. gate-script-base.test.mjs exists with tests for all exports.
2. loadbearing-test-gate.sh exits 0.
3. adr-gate.test.mjs E3 A2 assertion passes.

## Inner termination

Done-when-complete OR external HALT.

## Pointer

inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
