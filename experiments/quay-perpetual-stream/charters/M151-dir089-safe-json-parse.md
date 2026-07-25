# M151 — Safe JSON parse guard for experiment gate scripts

**Task:** DIR-089 · **Counter:** 151 · **Chart:** 2
**Class:** methodology · **Value type:** instrument-correction
**Deliverable:** no · **Charter tokens:** ~0.3 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

## Value hypothesis

Δv̂ = 0. Eliminates JSONDecodeError crashes in gate scripts by adding a reusable safe-parse guard. 4 identical traces found via meta-cc.

## Scope

Create `safe-json-parse.sh` — a sourceable shell library with `safe_json_parse` and `safe_json_parse_from_stdin` functions that guard against empty/non-JSON output. Audit and refactor existing gate scripts that parse JSON to use the guard.

## Touches
- experiments/quay-perpetual-stream/scripts/safe-json-parse.sh (new)
- experiments/quay-perpetual-stream/scripts/*.sh (modify JSON-parsing scripts)

## Done-when (binary)

1. `safe-json-parse.sh` exists with `safe_json_parse` and `safe_json_parse_from_stdin` functions.
2. All experiment gate scripts that parse JSON use the guard.
3. Selfchecks pass for all modified scripts.

## Inner termination

Done-when-complete OR external HALT.

## Pointer

inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
