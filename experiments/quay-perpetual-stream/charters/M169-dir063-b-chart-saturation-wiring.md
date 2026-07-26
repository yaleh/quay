# M169 — Wire chart-saturation-check as self-halt PRE-STEP

**Task:** DIR-063-B · **Counter:** 169 · **Chart:** 2
**Class:** development · **Value type:** governance-integrity
**Deliverable:** yes · **Charter tokens:** ~0.8 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0. Wires the already-landed chart-saturation-check detector into OUTER-LOOP.md's self-halt step as a PRE-STEP, so chart saturation is detected before emitting HALT. Subagent-drafting escalation gated strictly behind TRANSITION-DUE — prevents cost explosion.

## Scope
Two edits to OUTER-LOOP.md per DIR-063-B:
1. Make chart-saturation-check a PRE-STEP of the self-halt evaluation: when the pre-existing rolling-slope metric is below threshold, run detection first; if TRANSITION-DUE, escalate to one-time subagent draft with anti-gaming guard
2. Gate subagent-drafting escalation strictly behind TRANSITION-DUE flag — never per-milestone, never unconditional per-checkpoint

## Touches
- experiments/quay-perpetual-stream/OUTER-LOOP.md

## Done-when
1. OUTER-LOOP.md self-halt step invokes chart-saturation-check as a PRE-STEP before emitting HALT
2. Subagent-drafting escalation textually gated behind TRANSITION-DUE
3. Golden-replay: cp-120 evaluation outcome changes appropriately with the pre-step
4. All existing driver selfchecks + fixtures stay green
5. split-or-commit check passes

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
