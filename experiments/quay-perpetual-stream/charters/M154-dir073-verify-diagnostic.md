# M154 — Verify failure diagnostic + refactor Verify phase to direct script calls

**Task:** DIR-073 · **Counter:** 154 · **Chart:** 2
**Class:** methodology · **Value type:** governance-integrity
**Deliverable:** no · **Charter tokens:** ~0.4 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

## Value hypothesis

Δv̂ = 0. Reduces Verify phase agents from 5 to 2 (60% reduction) by running mechanical checks as direct Bash calls. Creates automated failure diagnosis for the remaining failures. Eliminates 5-10 turn manual debug loops (observed 83% Verify failure rate in session b643aa4d).

## Scope

1. Refactor execute-milestone.js Verify phase: replace 3 script-runner agents with direct Bash calls
2. Create diagnose-verify-failure.ts: parse workflow journal, classify failures, suggest fixes
3. Create diagnose-complex workflow: thin wrapper

## Touches
- .claude/workflows/execute-milestone.js (refactor Verify phase)
- experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts (new)
- .claude/workflows/diagnose-complex.js (new)

## Done-when (binary)

1. execute-milestone.js Verify phase: ceiling-check, gate-hash, line-budget run as direct Bash calls.
2. diagnose-verify-failure.ts exists, parses journal JSONL, outputs structured diagnostic.
3. diagnose-complex workflow exists.
4. Selfcheck: execute-milestone Verify phase completes with <=2 agents.
5. Existing selfchecks/fixtures stay green.

## Inner termination

Done-when-complete OR external HALT.

## Pointer

inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
