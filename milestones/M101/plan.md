# M101 Plan — gate/registry.ts factory split (ARCH-M93-001)

**Charter:** `experiments/quay-perpetual-stream/charters/M101-gate-registry-split.md`  
**Adjudication date:** 2026-07-22

## Adjudication Summary

Two proposals reviewed:

- **Proposal A**: `factories/utils.ts` for shared helpers (`GateConfig`, `RunnerOptions`, `shQuote`, `resolveRunnerOptions`); `factories/loader.ts` for workspace loader functions (`readGatesConfig`, `loadWorkspaceGates`, `discoverWorkspaceRoot`, entry interfaces); factory files import from `./utils.ts` (not from `../registry.ts`). Estimated registry.ts: ~120 lines.

- **Proposal B**: `shQuote` in `it0.ts`, imported by `fixed-script.ts`; shared types/helpers exported from `registry.ts` with factories importing back from it. Critical flaw: this creates a **circular import** — `registry.ts` → `./factories/index.ts` → factory files → `../registry.ts` (runtime import of `resolveRunnerOptions`). Also estimates registry.ts at ~160L, above the ≤150 target.

**Decision: Proposal A wins.** `factories/utils.ts` avoids circular imports. `factories/loader.ts` gets registry.ts to ~120 lines, cleanly under the ≤150 AC.

## Implementation Steps

### Step 1: Create `packages/quay/src/gate/factories/utils.ts`

Move from `registry.ts`:
- `GateConfig` interface (currently unexported)
- `RunnerOptions` interface (currently unexported)
- `shQuote` function (currently unexported private helper)
- `resolveRunnerOptions` function (currently unexported private helper)

Export all 4. This file has NO imports from `../registry.ts` or any other gate/ file (pure utilities: `node:child_process` or similar if needed, but likely none).

### Step 2: Create `packages/quay/src/gate/factories/loader.ts`

Move from `registry.ts`:
- `discoverWorkspaceRoot` function
- All entry interfaces: `It0Entry`, `FixedEntry`, `AdrEntry`, `TestPassEntry`, `CoverageEntry`, `RedGreenEntry`, `DocumentEntry`, `GateEntry` (the union)
- `GatesConfig` interface
- `readGatesConfig` function
- `loadWorkspaceGates` function (this is the function that instantiates factories and populates the registry)

This file needs to import:
- Factory functions from `./index.ts` (all 7 `make*` functions)
- Node fs/path/YAML imports (same as they are in registry.ts today)
- `GateDefinition`, `GateFn`, `GateVerdict` (types) from `../registry.ts` — type-only import, no circular issue
- Utils (`GateConfig`, `RunnerOptions`, `resolveRunnerOptions`) from `./utils.ts` if needed

Export: `loadWorkspaceGates`, `readGatesConfig`, `GatesConfig`, `discoverWorkspaceRoot`, and the entry interfaces.

### Step 3: Create the 7 factory files

Each file:
- `factories/it0.ts` — exports `makeIt0Gate` (~35L); imports: `type GateFn` from `../registry.ts` (type-only), `{ runAcceptance }` from `../acceptance-runner.ts`, `{ GateConfig, resolveRunnerOptions, shQuote }` from `./utils.ts`
- `factories/fixed-script.ts` — exports `makeFixedScriptGate` (~20L); same imports minus `shQuote` if not needed (check if it uses it)
- `factories/adr.ts` — exports `makeAdrGate` (~35L); imports: `type GateFn`, `{ runAcceptance }`, `{ GateConfig, resolveRunnerOptions }` from `./utils.ts`, `{ createAdrStore }` from `../../adr-store.ts`
- `factories/test-pass.ts` — exports `makeTestPassGate` (~20L); imports: `type GateFn`, `{ runAcceptance }`, `{ GateConfig, resolveRunnerOptions }` from `./utils.ts`
- `factories/coverage-floor.ts` — exports `makeCoverageFloorGate` (~60L); imports: `type GateFn`, `{ spawnSync }` from `node:child_process`, `{ GateConfig, resolveRunnerOptions }` from `./utils.ts`. Keep `spawnSyncCapture` + `SpawnCaptureResult` private to this file.
- `factories/red-green.ts` — exports `makeRedGreenGate` (~30L); imports: `type GateFn`, `{ runAcceptance }`, `{ GateConfig, resolveRunnerOptions }` from `./utils.ts`
- `factories/document-contract.ts` — exports `makeDocumentContractGate` (~30L); imports: `type GateFn`, `{ createDocumentStore }` from `../../document-store.ts`, `{ validateContracts }` from `../../contract-validator.ts`

**Type imports from `../registry.ts`:** Use `import type { GateFn, GateVerdict }` — type-only imports do NOT create runtime circular dependencies in TypeScript/Node ESM.

### Step 4: Create `packages/quay/src/gate/factories/index.ts`

Barrel re-export of all 7 factories. Does NOT re-export `utils.ts` or `loader.ts` content (those are consumed directly by `registry.ts` and `loader.ts` respectively).

```ts
export { makeIt0Gate } from "./it0.ts";
export { makeFixedScriptGate } from "./fixed-script.ts";
export { makeAdrGate } from "./adr.ts";
export { makeTestPassGate } from "./test-pass.ts";
export { makeCoverageFloorGate } from "./coverage-floor.ts";
export { makeRedGreenGate } from "./red-green.ts";
export { makeDocumentContractGate } from "./document-contract.ts";
```

### Step 5: Update `packages/quay/src/gate/registry.ts`

1. Remove factory function bodies (all 7 factories + their helpers: `shQuote`, `resolveRunnerOptions`, `GateConfig`, `RunnerOptions`, `spawnSyncCapture`, etc.)
2. Remove loader functions (`readGatesConfig`, `loadWorkspaceGates`, `discoverWorkspaceRoot`, entry interfaces, `GatesConfig`)
3. Add imports:
   - `import { makeIt0Gate, makeFixedScriptGate, makeAdrGate, makeTestPassGate, makeCoverageFloorGate, makeRedGreenGate, makeDocumentContractGate } from "./factories/index.ts";`
   - `export { loadWorkspaceGates, readGatesConfig, GatesConfig, discoverWorkspaceRoot } from "./factories/loader.ts";` (re-export so existing importers of these from registry.ts continue to work)
4. `registry.ts` retains: type exports (`GateFn`, `GateVerdict`, `GateDefinition`), `REPO_ROOT`, `gateRegistry` map (built-in gates), `registerDocumentGate`, `DOCUMENT_GATE_IDS`, `DOCUMENTS_DIR`, `resolveGate`, `listGates`
5. Target: ~120 lines

### Step 6: Verify no test breakage

Key check: `document-gate.test.mjs` may import `makeDocumentContractGate` directly via dynamic import from `registry.ts`. If so, ensure it's re-exported from `registry.ts` via the barrel chain (or update the import path in the test).

Run:
```bash
cd /home/yale/work/quay/packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')
```

All tests must pass without modification (or with minimal path-only changes if a test imports a factory directly).

### Step 7: One atomic commit

```
refactor(gate): split gate/registry.ts factory functions into gate/factories/ (ARCH-M93-001)
```

## File Changes Summary

| File | Action | Lines after |
|---|---|---|
| `packages/quay/src/gate/factories/utils.ts` | NEW | ~40L |
| `packages/quay/src/gate/factories/loader.ts` | NEW | ~140L |
| `packages/quay/src/gate/factories/it0.ts` | NEW | ~35L |
| `packages/quay/src/gate/factories/fixed-script.ts` | NEW | ~20L |
| `packages/quay/src/gate/factories/adr.ts` | NEW | ~35L |
| `packages/quay/src/gate/factories/test-pass.ts` | NEW | ~20L |
| `packages/quay/src/gate/factories/coverage-floor.ts` | NEW | ~60L |
| `packages/quay/src/gate/factories/red-green.ts` | NEW | ~30L |
| `packages/quay/src/gate/factories/document-contract.ts` | NEW | ~30L |
| `packages/quay/src/gate/factories/index.ts` | NEW | ~10L |
| `packages/quay/src/gate/registry.ts` | MODIFIED | ~120L (was 736L) |

## Acceptance Criteria Check

- [ ] `gate/registry.ts` ≤150 lines — expect ~120 lines ✓
- [ ] All factory files ≤120 lines; no file in gate/ exceeds 400 lines ✓
- [ ] All tests pass without modification ✓
- [ ] No circular imports (verified: factory files use type-only imports from registry.ts for `GateFn`) ✓
- [ ] One companion directory `gate/factories/` (10 files total) ✓

## Grounded Checks

1. **Circular import guard**: grep for `from "../registry"` or `from "../registry.ts"` in factory files — must all be `import type` (no runtime values)
2. **`loadWorkspaceGates` re-export**: any file currently importing `loadWorkspaceGates` from `gate/registry.ts` must continue to work — re-export from `registry.ts` handles this
3. **`shQuote` usage**: grep confirms it's used in `makeIt0Gate` AND `makeFixedScriptGate` — both must import it from `./utils.ts`
4. **`makeDocumentContractGate` test import**: if `document-gate.test.mjs` imports it directly, it imports from the factory file (not registry.ts) — check and update if needed
5. **`REPO_ROOT` usage in factories**: if any factory uses `REPO_ROOT`, it must be passed as a parameter or moved to utils.ts
