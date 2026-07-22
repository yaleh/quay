# Iteration-0 Acceptance Audit — M105 ARCH-M103-001

**Audit session id:** 8c2e96ff-5390-47a6-9d9a-f230ebb92335
**Milestone:** M105
**Task:** ARCH-M103-001
**Orchestrator session id:** a653b2e9-8c25-4560-8c85-bd3e757e56f3
**Auditor:** fresh-context adversarial pass (distinct from orchestrator session a653b2e9-8c25-4560-8c85-bd3e757e56f3)
**Date:** 2026-07-22

## Audit-independence check

Artifact: milestones/M105/audits/iteration-0-acceptance-audit.md
Orchestrator id: a653b2e9-8c25-4560-8c85-bd3e757e56f3
Dispatch record: /tmp/m105-dispatch-record.txt

This audit session id `8c2e96ff-5390-47a6-9d9a-f230ebb92335` is distinct from the orchestrator
session `a653b2e9-8c25-4560-8c85-bd3e757e56f3`. The adversarial audit reads the changed files
fresh and independently verifies each AC claim.

## Scope of change reviewed

- `packages/quay/src/gate/factories/index.ts`: replaced pure re-export barrel with imports +
  re-exports + `gateFactories` dispatch map (6 entries; `document-contract` excluded).
- `packages/quay/src/gate/factories/loader.ts`: replaced 6 individual factory imports with
  `import { gateFactories } from "./index.ts"`; replaced 6 `makeXxxGate(...)` call sites with
  `gateFactories["type"](...)` calls using identical arguments.

## AC1: `gateFactories` exported from `gate/factories/index.ts`; `loadWorkspaceGates` imports it instead of 6 separate functions

**Attempt to refute:** Does `loader.ts` still import any of the 6 individual factory functions?

Checking `packages/quay/src/gate/factories/loader.ts` import section — the import block reads:
```ts
import type { GateFn } from "../registry.ts";
import { gateFactories } from "./index.ts";
```

No individual factory imports (`makeIt0Gate`, `makeFixedScriptGate`, `makeAdrGate`,
`makeTestPassGate`, `makeCoverageFloorGate`, `makeRedGreenGate`) remain. Only `gateFactories`
(1 symbol) is imported from `./index.ts`.

**Result: CONFIRMED. Not refuted.**

## AC2: `loadWorkspaceGates` outDegree ≤4 confirmed by fresh archguard analysis

**Attempt to refute:** Could the dispatch map introduce additional hidden edges? Could the
archguard measurement be stale or scope-incomplete?

Fresh archguard analysis run with `noCache=true`, `lang="typescript"`, `projectRoot="/home/yale/work/quay"`.
Completed in 7.9s. Query data refreshed.

Dependency query for `loadWorkspaceGates` filtered to scope
`packages/quay/src/gate/factories/loader.ts.loadWorkspaceGates`:

**outDegree: 3**
```
packages/quay/src/gate/factories/loader.ts.loadWorkspaceGates -> packages/quay/src/gate/factories/index.ts.gateFactories
packages/quay/src/gate/factories/loader.ts.loadWorkspaceGates -> packages/quay/src/gate/factories/utils.ts.GateConfig
packages/quay/src/gate/factories/loader.ts.loadWorkspaceGates -> packages/quay/src/gate/registry.ts.GateFn
```

Before fix (M103 measurement): outDegree = 8
After fix (M105 measurement): outDegree = 3

AC requires ≤ 4. 3 ≤ 4. **CONFIRMED.**

The dispatch map `gateFactories` is counted as 1 archguard edge (to the exported object), not 6
separate edges (one per factory inside the map). This is the expected behavior: archguard measures
import-level edges at the symbol granularity, and `gateFactories` is a single exported symbol.
The claim that this reduces edges is verified by the measurement.

**Result: CONFIRMED. Not refuted.**

## AC3: All existing gate tests pass

**Attempt to refute:** Could the dispatch map change gate behavior? Could any factory call
receive wrong arguments?

The call sites in `loader.ts` use identical argument lists:
- `gateFactories["it0"](scriptPath, entry.argsKey, entry.name, gateConfigOf(entry))` — same as former `makeIt0Gate(scriptPath, entry.argsKey, entry.name, gateConfigOf(entry))`
- `gateFactories["adr"](adrId, adrDir)` — same as former `makeAdrGate(adrId, adrDir)`
- `gateFactories["fixed-script"](scriptPath, entry.name, gateConfigOf(entry))` — same as former `makeFixedScriptGate(scriptPath, entry.name, gateConfigOf(entry))`
- `gateFactories["test-pass"](entry.command, entry.name, gateConfigOf(entry))` — same as former `makeTestPassGate(entry.command, entry.name, gateConfigOf(entry))`
- `gateFactories["coverage-floor"](entry.command, entry.floor, entry.pattern, entry.name, gateConfigOf(entry))` — same as former `makeCoverageFloorGate(...)`
- `gateFactories["red-green"](entry.red, entry.green, entry.name, gateConfigOf(entry))` — same as former `makeRedGreenGate(...)`

The factories in `gateFactories` are the same function references (imported from the same per-factory
files via `index.ts`). No intermediate wrapper or adapter is introduced.

Test run: `node --test packages/quay/test/gate.test.mjs`

```
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12136.11378
```

25/25 PASS. No behavior regression.

**Result: CONFIRMED. Not refuted.**

## Additional adversarial consideration: circular import check

**Attempt to refute:** Does `index.ts` importing `GateFn` from `../registry.ts` create a circular
import? `registry.ts` imports from `./factories/index.ts` (for factory re-exports). Does
`index.ts` now back-importing from `../registry.ts` close a cycle?

The import in `index.ts` is `import type { GateFn } from "../registry.ts"` — this is a
**type-only import** (TypeScript `import type`). Type-only imports are erased at runtime (they
produce no JavaScript). Node.js module resolution does not see them. There is no runtime circular
dependency.

At the TypeScript type-check level: `registry.ts` imports factory functions from `./factories/index.ts`;
`index.ts` imports the `GateFn` type from `../registry.ts`. This is a type-level cycle. TypeScript
handles type-level cycles correctly (types are structurally resolved, not executed). The existing
test suite running 25/25 confirms no import-time errors occur.

**Result: No circular import issue. Not refuted.**

## Additional adversarial consideration: `makeDocumentContractGate` correctly excluded

**Attempt to refute:** Should `makeDocumentContractGate` be in `gateFactories`?

`makeDocumentContractGate` is constructed in `gate/registry.ts` as a built-in gate in
`gateRegistry` (the static registry), not dispatched dynamically via `loadWorkspaceGates`. Including
it in `gateFactories` would be wrong (it is not a workspace-data-driven gate type; gates.yml does
not have a `document-contract:` section). The charter and plan both explicitly state it is excluded.

Verified: `gateFactories` in `index.ts` contains exactly 6 keys (`"it0"`, `"fixed-script"`,
`"adr"`, `"test-pass"`, `"coverage-floor"`, `"red-green"`). No `"document-contract"` key.

**Result: CONFIRMED correctly excluded. Not refuted.**

## Verdict

**NO REFUTATION FOUND.**

All AC claims verified independently:
- `gateFactories` is exported from `gate/factories/index.ts` (6 entries, `document-contract` correctly excluded).
- `loadWorkspaceGates` imports only `gateFactories` (1 symbol), not 6 individual factory functions.
- outDegree confirmed 3 (≤ 4 AC satisfied) by fresh archguard analysis (noCache=true).
- All 25 gate tests PASS. No behavior regression.
- No circular imports (type-only import from registry.ts is runtime-erased).
