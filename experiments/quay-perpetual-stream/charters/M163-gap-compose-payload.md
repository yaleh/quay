# M163 — Fix composePayload crash on undefined button.payload

**Task:** gap-composePayload-null-payload · **Counter:** 163 · **Chart:** 2
**Class:** development · **Value type:** capability-growth
**Deliverable:** no · **Charter tokens:** ~0.2 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ = 0. Fixes crash when action_button manifest entry omits payload field.

## Scope
Add null check for button.payload before calling replaceAll().

## Touches
- packages/quay/src/action.ts

## Done-when
1. composePayload returns clear error (not crash) when payload is undefined.
2. Existing tests pass.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
