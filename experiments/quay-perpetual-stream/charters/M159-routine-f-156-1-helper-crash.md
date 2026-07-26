# M159 — Fix test helper subprocess crash on direct discovery

**Task:** exp5-M-ROUTINE-F-156-1 · **Counter:** 159 · **Chart:** 2
**Class:** methodology · **Value type:** instrument-correction
**Deliverable:** no · **Charter tokens:** ~0.2 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0. Fixes 3 test helper scripts that crash when node --test discovers them directly, masking real regressions.

## Scope

Add early-exit guards to cas-writer-helper.mjs, concurrent-writer.mjs, reparent-writer.mjs.

## Touches
- packages/quay-native/test/cas-writer-helper.mjs
- packages/quay-native/test/concurrent-writer.mjs
- packages/quay-native/test/reparent-writer.mjs

## Done-when (binary)

1. node --test packages/quay-native/test/*.mjs produces zero helper-crash failures.
2. Parent spawn tests unchanged.

## Inner termination

Done-when-complete OR external HALT.

## Pointer

inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
