# M152 — Extract shared gate-script framework

**Task:** DIR-091 · **Counter:** 152 · **Chart:** 2
**Class:** methodology · **Value type:** instrument-correction
**Deliverable:** no · **Charter tokens:** ~0.3 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

## Value hypothesis

Δv̂ = 0. Reduces duplication across 50 gate scripts (34 checks + 16 selfchecks) by extracting shared arg parsing, YAML reading, and output formatting into a reusable framework.

## Scope

Create `gate-script-lib.sh` (shell) and `gate-script-base.ts` (TS) providing shared primitives. Refactor at least 5 existing check scripts to use the framework. Target >=200 lines reduction.

## Touches
- experiments/quay-perpetual-stream/scripts/gate-script-lib.sh (new)
- experiments/quay-perpetual-stream/scripts/gate-script-base.ts (new)
- experiments/quay-perpetual-stream/scripts/ (refactor >=5 check scripts)

## Done-when (binary)

1. `gate-script-lib.sh` and `gate-script-base.ts` exist with shared primitives.
2. At least 5 check scripts refactored to use the framework.
3. All refactored scripts pass their selfchecks.
4. Line-count reduction >=200 total.

## Inner termination

Done-when-complete OR external HALT.

## Pointer

inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
