# M161 — Document single-writer constraint for gate-event-store

**Task:** gap-gate-event-store-concurrency · **Counter:** 161 · **Chart:** 2
**Class:** development · **Value type:** capability-growth
**Deliverable:** no · **Charter tokens:** ~0.2 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0. Documents the single-writer constraint on gate-event-store. appendGateEvent lacks concurrency protection unlike the native store which uses lockfile guards.

## Scope

Add code comment documenting the single-writer constraint with reference to the native store's lockfile pattern for future hardening.

## Touches
- packages/quay/src/gate/gate-event-store.ts

## Done-when (binary)

1. Code comment documents single-writer constraint with pointer to native store lockfile pattern.

## Inner termination

Done-when-complete OR external HALT.

## Pointer

inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
