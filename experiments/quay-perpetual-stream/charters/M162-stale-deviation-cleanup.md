# M162 — Update stale deviation row

**Task:** exp5-M-STALE-DEVIATION-CLEANUP-162 · **Counter:** 162 · **Chart:** 2
**Class:** methodology · **Value type:** instrument-correction
**Deliverable:** no · **Charter tokens:** ~0.2 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ = 0. Fixes stale deviation record. Backward-compat regression fixed post-hoc but row still "open".

## Scope
Update dashboard.md deviation row from "open" to "verified-eliminated".

## Touches
- experiments/quay-perpetual-stream/dashboard.md

## Done-when
1. Stale deviation row status updated to "verified-eliminated".

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
