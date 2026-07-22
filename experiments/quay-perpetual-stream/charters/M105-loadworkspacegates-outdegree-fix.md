# Charter M105-loadworkspacegates-outdegree-fix — loadWorkspaceGates outDegree fix (ARCH-M103-001)

**Milestone id:** M105  
**Task:** `tasks/ARCH-M103-001.md` (milestone-candidate, defect)  
**Surface:** `packages/quay/src/gate/factories/loader.ts` + `packages/quay/src/gate/factories/index.ts`  
**Type:** development-class / defect  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

`gate/factories/loader.ts.loadWorkspaceGates` has outDegree=8 — the new highest-outDegree function in the codebase (M103 fresh measurement). The 8 edges come from importing all 6 gate factory functions individually plus `GateConfig` and `GateFn`:

```
gate/factories/loader.ts.loadWorkspaceGates ->
  [1] gate/factories/index.ts.makeAdrGate
  [2] gate/factories/index.ts.makeCoverageFloorGate
  [3] gate/factories/index.ts.makeFixedScriptGate
  [4] gate/factories/index.ts.makeIt0Gate
  [5] gate/factories/index.ts.makeRedGreenGate
  [6] gate/factories/index.ts.makeTestPassGate
  [7] gate/factories/utils.ts.GateConfig
  [8] gate/registry.ts.GateFn
```

The function uses a switch/dispatch pattern: given a gate type string from YAML config (`"it0"`, `"fixed-script"`, etc.), it calls the corresponding factory function. This requires importing all 6 factories statically.

**Fix (M99 pattern applied):** Add a `gateFactories` dispatch map to `gate/factories/index.ts`. This is a record object `{ "it0": makeIt0Gate, "fixed-script": makeFixedScriptGate, ... }` exported as one named entity. `loadWorkspaceGates` imports only `gateFactories` (1 archguard edge) instead of 6 separate functions. outDegree drops from 8 to 3 (gateFactories + GateConfig + GateFn).

## Scope

**In scope:**

1. **Add `gateFactories` to `gate/factories/index.ts`:**
   ```ts
   export const gateFactories: Record<string, (...args: any[]) => GateFn> = {
     "it0": makeIt0Gate,
     "fixed-script": makeFixedScriptGate,
     "adr": makeAdrGate,
     "test-pass": makeTestPassGate,
     "coverage-floor": makeCoverageFloorGate,
     "red-green": makeRedGreenGate,
     // "document-contract" excluded: it is constructed specially in gateRegistry, not via loadWorkspaceGates
   };
   ```
   (Type the map properly using the factory function signatures from the existing imports in `loader.ts`.)

2. **Update `gate/factories/loader.ts`:**
   - Remove the 6 individual factory imports
   - Import only `gateFactories` from `./index.ts`
   - Update the switch/dispatch in `loadWorkspaceGates` to use `gateFactories[entry.type]` instead of individual factory calls
   - Keep `GateConfig` import from `./utils.ts` and type imports from `../registry.ts` (these are needed; only the 6 factory symbol imports are removed)

3. **Verify archguard outDegree ≤4:** fresh measurement (global scope, noCache=true) after implementation.

4. **All existing gate tests pass** without modification.

**Out of scope:**
- Changing gate behavior or factory implementations
- `makeDocumentContractGate` — it is special-cased in `gate/registry.ts.gateRegistry` as a built-in, not via `loadWorkspaceGates`. Don't add it to `gateFactories` (wrong dispatch path).
- ARCH-M103-002 (already closed as WONTFIX at M104)

## Class routing

**Development-class** — code change in `packages/quay/src/gate/factories/`. Requires quay-task-to-plan (N=2 proposals → adjudication → plan → executor). Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] `loadWorkspaceGates` outDegree ≤4 confirmed by fresh archguard analysis (global scope, noCache=true). Pasted output.
- [ ] `gateFactories` map exported from `gate/factories/index.ts`; `loadWorkspaceGates` imports it instead of 6 separate functions.
- [ ] All existing gate tests pass (`node --test packages/quay/test/gate.test.mjs` and related).

## Definition of Done

- [ ] Archguard outDegree ≤4 confirmed (global scope, noCache=true); pasted output.
- [ ] Full test suite passes; no gate behavior regression.
- [ ] Fresh-context adversarial audit: NO REFUTATION FOUND.
- [ ] it0 DoD meta-enforcer: all 12 clauses PASS.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
