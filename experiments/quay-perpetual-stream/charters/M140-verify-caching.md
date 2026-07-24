# M140 — Per-it0-check incremental caching in Verify phase

**Task:** DIR-079
**Milestone counter:** 140
**Chart:** 2
**Class:** methodology (instrument-correction)
**Value type:** instrument-correction
**Cadence:** exploit
**Deliverable:** no (loop's own gate machinery)
**Charter tokens:** ~0.5 K
**type:** learning

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (gate infrastructure). Real value: M135's 5 Verify retries consumed ~30 agent
dispatches (5 agents × 6 attempts). With per-check fingerprint caching, after fixing
ONLY the failed check, subsequent retries dispatch only the changed check (1 agent instead
of 5). M135 scenario: 30→~10 agent dispatches.

## Scope

One file change:

1. `execute-milestone.js` Verify phase: compute per-check input fingerprints, cache
   results keyed by {label, fingerprint}. On retry, skip agents whose fingerprint
   matches a prior {ok: true} result.

## Touches
- .claude/workflows/execute-milestone.js

## Done-when (binary)

1. Each it0 check's input fingerprint computed before Verify agent dispatch.
2. Unchanged fingerprint + prior ok → SKIP (cached result reused).
3. Changed fingerprint or no prior → dispatched as normal.
4. Fingerprint computation failure → fall back to full 5-check re-run.

## Inner termination

Done-when-complete (4 clauses) OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
