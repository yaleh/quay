# M170 — Wire D-quota into SELECT + remove governance:product HALT

**Task:** DIR-066-B · **Counter:** 170 · **Chart:** 2
**Class:** development · **Value type:** governance-integrity
**Deliverable:** yes · **Charter tokens:** ~0.8 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0. Wires the pre-existing D-quota governor into OUTER-LOOP SELECT step 1 and removes the governance:product HALT clause from the self-halt block. Escrow close-out for the prior partial landing.

## Scope
Two edits per DIR-066-B (some already on master from prior landing):
1. SELECT step 1: Round-1 D-quota composition via composeShortlist (deliverable:yes|no classification, streak, S∈[1,4])
2. Self-halt: remove governance:product→HALT-RECOMMENDED; demoted to informational only

## Touches
- experiments/quay-perpetual-stream/OUTER-LOOP.md
- experiments/quay-perpetual-stream/scripts/governance-product-ratio-check.ts (already fixed)

## Done-when
1. SELECT step 1 describes Round-1 D-quota composition (deliverable, streak, composeShortlist)
2. No governance:product-ratio HALT clause remains in self-halt block
3. governance-product-ratio-check.ts emits INFORMATIONAL only, not HALT-RECOMMENDED
4. VT-slope hard-halt input still present and unchanged
5. All existing driver selfchecks + fixtures stay green
6. split-or-commit check passes

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
