# M157 — Fix enforcement-with-design gate: DoD heading regex mismatch

**Task:** exp5-M-ROUTINE-F-156-2 · **Counter:** 157 · **Chart:** 2
**Class:** methodology · **Value type:** instrument-correction
**Deliverable:** no · **Charter tokens:** ~0.2 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0. Fixes a regex mismatch causing the enforcement-with-design gate to always fail. `it0-enforcement-with-design-check.ts` searches for `## Definition of Done` but inherited-core.md uses `## Definition of DoD`.

## Scope

Fix regex in it0-enforcement-with-design-check.ts line 52 to match the actual heading.

## Touches
- experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts

## Done-when (binary)

1. `it0-enforcement-with-design-check.ts .` exits 0 (no PARSE-ERROR).

## Inner termination

Done-when-complete OR external HALT.

## Pointer

inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
