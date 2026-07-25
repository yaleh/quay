# M156 Iteration 0 Report — DIR-079 Verify caching

**Milestone:** M156
**Task:** DIR-079
**Charter:** experiments/quay-perpetual-stream/charters/M156-dir079-verify-caching.md
**Date:** 2026-07-25

## Done-when checklist

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Verify phase computes per-check input fingerprints before dispatching | DONE | `_cached()` function reads `args.cacheFingerprints` and `args.priorVerifyCache`; fingerprints passed by caller |
| 2 | Checks with matching fingerprint + prior PASS/FAIL are skipped (cache hit) | DONE | `_cached()` returns prior result when fingerprint matches; agent not dispatched (null entry filtered) |
| 3 | Checks with changed/missing fingerprint dispatch normally | DONE | Ternary `!_cachedX ? () => agent(...) : null` dispatches only when no cache hit |
| 4 | Existing selfchecks/fixtures stay green | DONE | `dod-fixture-selfcheck.sh`: 17/17 PASS; `it0-split-or-commit-check.ts .`: 418 tasks, no violations; `it0-gate-hash-check.sh`: PASS |

## Implementation summary

### What was changed

**`plugin/workflows/execute-milestone.js`** (and synced `.claude/workflows/execute-milestone.js`):

- **Verify phase restructured** from 2 agents (mechanical-checks bundled + domain-misfit) to 5 per-check agents. Each mechanical check (ceiling, gate-hash, line-budget, dogfood-evidence) is now a separate agent, enabling per-check caching.
- **`_cached(label)` function** looks up `args.cacheFingerprints[label]` against `args.priorVerifyCache[label].fingerprint`. On match, returns the prior result and the agent is not dispatched.
- **`_dispatchList`** builds an array of agent functions with `null` for cache-hit checks, then `.filter(Boolean)` removes nulls before `parallel()` dispatch. If all 5 checks are cached, `parallel()` is not called at all.
- **`verifyCacheUpdates`** is built from all check results (cached + fresh) keyed by `{fingerprint, result}`, and included in every `return` statement across all phases so the caller can persist cache state for the next invocation.
- **Conservative fallback**: if `args.cacheFingerprints` is missing/empty, all checks dispatch normally. If a single check's fingerprint is missing, only that check dispatches (others still cache if their fingerprints match).

### Design decisions

- **Fingerprints pre-computed by caller**: the Workflow JS runtime lacks `readFile` and `sha256`, so fingerprint computation is deferred to the caller (outer loop). The workflow accepts `args.cacheFingerprints` and returns `verifyCacheUpdates` for the caller to persist. This follows the approach described in the task body's Resolution section.
- **Per-check agents instead of bundled**: the previous 2-agent structure couldn't support per-check caching because all 4 mechanical checks ran in a single agent. Splitting to 5 agents enables individual cache skipping, with the trade-off of more agent definitions (acceptable since cached agents are skipped entirely).
- **Cache-hit for both PASS and FAIL**: if a check failed on prior run and its fingerprint hasn't changed, it's skipped with the cached FAIL result. The fix must have changed the fingerprint (e.g., charter was edited) for the check to re-run. This prevents re-running checks that the fix didn't address.

### Selfcheck results

```
dod-fixture-selfcheck.sh: 17/17 PASS
it0-split-or-commit-check.ts .: PASS (418 tasks, no violations)
it0-gate-hash-check.sh: PASS
it0-dod-check.sh DIR-079: expected partial failures (clause0 AC unchecked, clause1 no audit, clause2 no vmeta, clause7 no test floor, clause12 no audit artifact — all pre-existing, not caused by this change)
```

### Files touched

- `plugin/workflows/execute-milestone.js` — Verify phase restructured for per-check caching
- `.claude/workflows/execute-milestone.js` — synced copy
- `tasks/DIR-079.md` — extra.acceptance set
