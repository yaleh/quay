# M147 iteration-2 -- DIR-095: Finalize (post-audit promotion)

**Date:** 2026-07-25
**Milestone:** M147
**Task:** DIR-095
**Charter:** experiments/quay-perpetual-stream/charters/M147-dir095-version-consistency.md
**Iteration:** 2 (post-audit finalization)

## Outcome

Done. All AC and DoD clauses verified. Task promoted to ready.

## Changes

### 1. AC/DoD checkboxes filled with audit evidence

All 2 AC and 3 DoD checkboxes checked with audit evidence from M147 acceptance audit:

- AC1: version-consistency-check.test.ts exits 0 (9/9 pass)
- AC2: Session-start healthcheck clean (VERSION-CONSISTENCY: OK)
- DoD1: All 8 files at 0.3.13 (confirmed by --json mode)
- DoD2: Version consistency test passes (9/9 pass)
- DoD3: No regression (gate 25/0, lifecycle 27/0)

### 2. Status promoted to ready

Task promoted from `todo` to `ready` via `task_write` with `expectedStatus: todo`.

## Done-when verification

1. All 8 version-bearing files synced to consistent version. -- CONFIRMED (all 0.3.13)
2. `node --test scripts/version-consistency-check.test.ts` exits 0. -- CONFIRMED (9/9 pass)
3. Session-start healthcheck no longer warns. -- CONFIRMED (VERSION-CONSISTENCY: OK)

## Real evidence

```
# Version consistency check
$ node --experimental-strip-types scripts/version-consistency-check.ts --json
{"ok":true,"uniqueVersions":["0.3.13"],"mode":"all-equal"}

# Version consistency tests
$ node --experimental-strip-types --test scripts/version-consistency-check.test.ts
pass 9, fail 0

# Gate tests
$ node --test packages/quay/test/gate.test.mjs
pass 25, fail 0

# Lifecycle tests
$ node --test packages/quay/test/lifecycle.test.mjs
pass 27, fail 0
```

## Prior iteration reference

Iteration-1 (commit `2a8b0d5`) synced plugin/.claude-plugin/plugin.json from 0.4.0 to 0.3.13 --
the sole drifted file among 8 version-bearing entries. This iteration finalizes with AC/DoD
evidence and promotes the task to ready.

## Files changed

- `tasks/DIR-095.md` -- AC/DoD checkboxes checked with audit evidence; status todo→ready
