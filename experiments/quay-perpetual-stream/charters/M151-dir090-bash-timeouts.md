# M151 — Audit Bash timeouts in gate and workflow scripts

**Task:** DIR-090 · **Counter:** 151 · **Chart:** 2
**Class:** methodology · **Value type:** instrument-correction
**Deliverable:** no · **Charter tokens:** ~0.3 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

## Value hypothesis

Δv̂ = 0. Eliminates Bash timeout errors in gate and workflow scripts by adding explicit timeout parameters. 6 identical traces found via meta-cc.

## Scope

Audit gate scripts and workflow scripts for bare Bash calls that invoke long-running commands (`npm install`, `npm test`, `git clone`) without explicit timeout. Add `timeout` parameter >=5m (300000ms) to each.

## Touches
- experiments/quay-perpetual-stream/scripts/ (modify gate scripts)
- .claude/workflows/ (modify workflow scripts)

## Done-when (binary)

1. All gate scripts invoking `npm install`, `npm test`, or `git clone` have explicit `timeout` >=5m.
2. All workflow scripts with long-running Bash calls have explicit `timeout` >=5m.

## Inner termination

Done-when-complete OR external HALT.

## Pointer

inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
