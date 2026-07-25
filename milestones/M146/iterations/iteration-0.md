# M146 Iteration 0 — DIR-087: Extract gate factory config

**Date:** 2026-07-25
**Status:** done
**Charter:** experiments/quay-perpetual-stream/charters/M146-dir087-extract-gate-config.md

## Scope

Instrument-correction refactoring: extract gate factory config types and functions from
`packages/quay/src/gate/factories/` into a new `packages/quay/src/gate/config/` module to
reduce fanOut.

## Changes

### New files

- `packages/quay/src/gate/config/types.ts` — `GateConfig`, `RunnerOptions`, `GatesConfig`,
  `It0Entry`, `FixedEntry`, `TestPassEntry`, `CoverageFloorEntry`, `RedGreenEntry`
- `packages/quay/src/gate/config/utils.ts` — `shQuote`, `resolveRunnerOptions`
- `packages/quay/src/gate/config/loader.ts` — `discoverWorkspaceRoot`, `readGatesConfig`,
  `loadWorkspaceGates`
- `packages/quay/src/gate/config/index.ts` — barrel re-exports

### Modified files

- `packages/quay/src/gate/factories/utils.ts` — replaced inline definitions with re-exports
  from `../config/`
- `packages/quay/src/gate/factories/loader.ts` — replaced inline definitions with re-exports
  from `../config/`
- `packages/quay/src/gate/registry.ts` — updated imports from `./factories/loader.ts` and
  `./factories/utils.ts` to `./config/loader.ts` and `./config/utils.ts`; re-export chains
  updated accordingly

### Backward compatibility

All existing import paths through `factories/utils.ts` and `factories/loader.ts` continue to
work via re-exports. Individual factory files (`it0.ts`, `adr.ts`, `fixed-script.ts`,
`test-pass.ts`, `coverage-floor.ts`, `red-green.ts`) are unchanged — they still import from
`./utils.ts`.

## Verification

### Tests

```
node --test test/gate.test.mjs test/gate-ergonomics.test.mjs
tests 34, pass 34, fail 0
```

### Archguard metrics

| Package      | Before (fanOut) | After (fanOut) | Delta |
|-------------|-----------------|----------------|-------|
| factories    | 29              | 19             | -10   |
| config (new) | N/A             | 8              | +8    |

- AC target: fanOut reduction >= 5. Achieved: reduction of 10.
- No cycles introduced (archguard_detect_cycles: empty).
- `registry.ts` fanOut also reduced: previously imported from 2 separate factories modules;
  now imports from the single `config/` module.
