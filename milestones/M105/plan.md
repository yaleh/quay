# M105 Plan — loadWorkspaceGates outDegree fix (ARCH-M103-001)

**Charter:** `experiments/quay-perpetual-stream/charters/M105-loadworkspacegates-outdegree-fix.md`  
**Adjudication date:** 2026-07-22  
**Type:** development-class / defect

## Adjudication

Both proposals independently agree on the identical fix strategy:

- **Approach**: Add `gateFactories` dispatch map to `gate/factories/index.ts`; update `loader.ts` to import `gateFactories` (1 symbol) instead of 6 individual factory functions.
- **Type**: `Record<string, (...args: any[]) => GateFn>` — allows direct call sites without per-factory casts.
- **index.ts style** (Proposal B): consolidate to `import { X } from "./X.ts"; export { X };` pattern — cleaner ES module form.
- **No circular import**: `import type { GateFn } from "../registry.ts"` in index.ts is type-only (runtime-erased). `loader.ts → index.ts` direction unchanged.
- **Call sites in loader.ts**: direct `gateFactories["type"](args...)` — no casts needed with `any` args type.
- **Proposal B's `GateFactory` type export**: rejected — out of scope, not in charter AC.
- **makeDocumentContractGate**: excluded from gateFactories (handled in gateRegistry, not loadWorkspaceGates).

**Expected outDegree after fix**: 3 edges (gateFactories + GateConfig + GateFn). ≤4 AC met.

## Steps

1. **Update `packages/quay/src/gate/factories/index.ts`**:
   - Replace `export { X } from "./X.ts"` re-exports with `import { X } from "./X.ts"; export { X };` form
   - Add `import type { GateFn } from "../registry.ts";` (type-only)
   - Add `gateFactories: Record<string, (...args: any[]) => GateFn>` map with all 6 factories (exclude makeDocumentContractGate)

2. **Update `packages/quay/src/gate/factories/loader.ts`**:
   - Remove 6 individual factory imports (makeIt0Gate, makeFixedScriptGate, makeAdrGate, makeTestPassGate, makeCoverageFloorGate, makeRedGreenGate)
   - Add: `import { gateFactories } from "./index.ts";`
   - Replace 6 `makeXxxGate(...)` call sites with `gateFactories["type"](args...)`

3. **Run tests**: `node --test packages/quay/test/gate.test.mjs`

4. **Verify archguard outDegree**: fresh archguard analysis (global scope, noCache=true); confirm loadWorkspaceGates outDegree ≤4. Paste output.

5. **Update task ARCH-M103-001**: check AC/DoD boxes, status→done.

6. **Run DoD meta-enforcer**: `node experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs`

7. **Write adversarial audit artifact** to `milestones/M105/audits/iteration-0-acceptance-audit.md`

8. **Commit**: `git add packages/quay/src/gate/factories/ tasks/ARCH-M103-001.md milestones/M105/ && git commit -m "fix(ARCH-M103-001): gateFactories map — loadWorkspaceGates outDegree 8→3 (M105)"`

9. Write ABSORB entry to `/tmp/m105-absorb-entry.md`

## Acceptance Criteria Check

- [ ] `gateFactories` map exported from `gate/factories/index.ts`; `loadWorkspaceGates` imports it instead of 6 separate functions
- [ ] `loadWorkspaceGates` outDegree ≤4 confirmed by fresh archguard analysis (global scope, noCache=true)
- [ ] All existing gate tests pass (`node --test packages/quay/test/gate.test.mjs`)
