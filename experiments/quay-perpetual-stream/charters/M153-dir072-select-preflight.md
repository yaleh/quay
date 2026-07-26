# M153 — SELECT preflight script + thin classify-deliverable workflow

**Task:** DIR-072 · **Counter:** 153 · **Chart:** 2
**Class:** methodology · **Value type:** governance-integrity
**Deliverable:** no · **Charter tokens:** ~0.4 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

## Value hypothesis

Δv̂ = 0. Encapsulates OUTER-LOOP SELECT preflight (steps 1-3) from ~15 manual turns into a deterministic script + thin 2-phase workflow with exactly one LLM agent call. Closes a governance-integrity gap: the SELECT process is un-encapsulated and drift-prone.

## Scope

1. `scripts/select-preflight.ts` — pure functions + CLI producing structured PreflightResult JSON
2. `.claude/workflows/select-preflight.js` — thin 2-phase workflow (RunScript → ClassifyDeliverable → ComposeShortlist)
3. OUTER-LOOP.md steps 1-3 rewritten to <=10 lines

## Touches
- experiments/quay-perpetual-stream/scripts/select-preflight.ts (new)
- .claude/workflows/select-preflight.js (new)
- experiments/quay-perpetual-stream/OUTER-LOOP.md (rewrite steps 1-3)

## Done-when (binary)

1. `select-preflight.ts` exists, outputs valid PreflightResult JSON, unit-tested.
2. `select-preflight.js` exists with exactly ONE agent call (deliverable classification).
3. OUTER-LOOP.md steps 1-3 rewritten to invoke `/select-preflight`.
4. Existing selfchecks/fixtures stay green.

## Inner termination

Done-when-complete OR external HALT.

## Pointer

inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
