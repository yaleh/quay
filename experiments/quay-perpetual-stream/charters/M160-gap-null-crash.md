# M160 — Fix serve null dereference on nonexistent task action

**Task:** gap-handleTaskAction-null-crash · **Counter:** 160 · **Chart:** 2
**Class:** development · **Value type:** capability-growth
**Deliverable:** no · **Charter tokens:** ~0.2 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0. Fixes null dereference crash in serve when POSTing to nonexistent task action endpoint.

## Scope

Add null check in handleTaskAction matching existing pattern in handleTaskDetail.

## Touches
- packages/quay/src/serve-handlers.ts

## Done-when (binary)

1. handleTaskAction returns 404 for nonexistent task (instead of crashing).
2. Existing serve tests stay green.

## Inner termination

Done-when-complete OR external HALT.

## Pointer

inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
