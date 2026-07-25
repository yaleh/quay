# M159 Iteration 0 -- Build Report

**Task:** exp5-M-ROUTINE-F-156-1
**Charter:** experiments/quay-perpetual-stream/charters/M159-routine-f-156-1-helper-crash.md
**Base commit:** 6a32e37 (M158: create gate-script-base.test.mjs)
**Date:** 2026-07-25

## Summary

Added early-exit guards to three test helper subprocess scripts in
`packages/quay-native/test/` that crashed when discovered directly by
`node --test`.

## Problem

Three `.mjs` helper files (`cas-writer-helper.mjs`, `concurrent-writer.mjs`,
`reparent-writer.mjs`) are subprocess scripts spawned by parent test files.
They destructure `process.argv` for positional args (tasksDir, id, mode, etc.)
that only exist when spawned -- when `node --test` discovers them directly,
`tasksDir` is `undefined`, causing `createStore()` to crash at
`fs.mkdirSync(tasksDir, ...)` with `ERR_INVALID_ARG_TYPE`.

Running `node --test packages/quay-native/test/*.mjs` produced 3 failures out
of 46 tests, masking real regressions.

## Fix

Added an `if (process.argv.length < N)` early-exit guard to each helper,
before the `process.argv` destructure. When args are missing (direct discovery
by the test runner), the script prints a one-line message to stderr and exits 0
-- the test runner treats 0 tests / 0 failures as passing. When spawned by a
parent test with full args, the existing behavior is unchanged.

Files changed:

| File | Guard check | Parent test |
|---|---|---|
| `packages/quay-native/test/cas-writer-helper.mjs` | `process.argv.length < 5` | `cas-write.test.mjs` |
| `packages/quay-native/test/concurrent-writer.mjs` | `process.argv.length < 6` | `lock.test.mjs` |
| `packages/quay-native/test/reparent-writer.mjs` | `process.argv.length < 5` | `relation-sync.test.mjs` |

Additionally, `extra.acceptance` was set on the task file
(`tasks/exp5-M-ROUTINE-F-156-1.md`) per the pre-flight step.

## Test Results

### Full suite: `node --test packages/quay-native/test/*.mjs`

```
tests 46, pass 46, fail 0
```

Zero helper-crash failures. All three helper files exit 0 when discovered
directly (with a stderr message identifying their parent test).

### Parent tests (individual verification)

- `cas-write.test.mjs` -- 1/1 pass, all 12 CAS-write assertions pass
- `lock.test.mjs` -- 1/1 pass, all 7 QN-006 lock assertions pass
- `relation-sync.test.mjs` -- 1/1 pass, all 22 M35-native-relation-sync assertions pass

No change to parent test behavior or helper subprocess contracts.

## Done-when Verification

1. `node --test packages/quay-native/test/*.mjs` produces zero helper-crash
   failures -- **PASS** (46/46, 0 failures)
2. Parent spawn tests unchanged -- **PASS** (cas-write, lock, relation-sync
   all pass individually)

## Touches

- `tasks/exp5-M-ROUTINE-F-156-1.md` -- added `extra.acceptance`
- `packages/quay-native/test/cas-writer-helper.mjs` -- +10 lines (early-exit guard)
- `packages/quay-native/test/concurrent-writer.mjs` -- +10 lines (early-exit guard)
- `packages/quay-native/test/reparent-writer.mjs` -- +10 lines (early-exit guard)

## Outcome

Done-when-complete. Ready for acceptance audit and absorb.
