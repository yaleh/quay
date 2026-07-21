**Audit session id:** m84-iter0-ts-migration-p3b2-2026-07-21
**Milestone:** M84 (exp5-M-TS-MIGRATION-P3-B-2)
**Verdict:** NO REFUTATION FOUND

## Audit checks

### 1. `npx tsc --noEmit` — exit 0

```
$ cd milestones/M84/worktrees/iteration-0 && npx tsc --noEmit 2>&1
(no output — clean exit 0)
```

Exit code: **0**

### 2. Renamed .ts files — no `@ts-nocheck`, public shapes typed

Checked 3 files:

**gate-event-store.ts**: Exports `GateEvent` and `GateEventFilter` as TypeScript interfaces (replacing JSDoc `@typedef`). `appendGateEvent(logPath: string, event: GateEvent): void` and `queryGateEvents(logPath: string, filter: GateEventFilter = {}): GateEvent[]` — fully typed signatures. No `@ts-nocheck`.

**registry.ts**: Had `@ts-nocheck` in the original; removed. Exports `GateDefinition` interface (with `description?`, `onPass?`, `onFail?`, `check?` fields) and `GateFn` type alias. All factory functions (makeIt0Gate, makeAdrGate, makeDocumentContractGate, etc.) typed. `resolveGate`, `loadWorkspaceGates`, `listGates` — all public signatures typed.

**lifecycle.ts**: Had no `@ts-nocheck`. Exports `TRANSITIONS`, `legalForward`, `legalBack`, `assertTransition`, `runComplete`, `runAdjudicate`, `runPromote`, `runRetreat` — all typed with `LifecycleArgs`, `RetreatArgs`, `LifecycleResult`, `PromoteResult`, `RetreatResult` interfaces. Uses `Task` from `../abi.ts`.

```
$ grep -r "@ts-nocheck" packages/quay/src/gate/*.ts
(empty output)
```

### 3. `GateDefinition` interface in registry.ts

Confirmed. `registry.ts` exports:

```typescript
export interface GateDefinition {
  description?: string;
  onPass?: string;
  onFail?: string;
  check?: (task: Task, client: unknown) => Promise<GateVerdict>;
}

export type GateFn = (task: Task, client: unknown) => Promise<GateVerdict>;
```

No `any` on primary public-facing function signatures. Dynamic plugin loads typed as `unknown` and cast at point of use.

### 4. Test suites — baselines confirmed

**quay + quay-native:**
```
ℹ tests 388
ℹ pass 379
ℹ fail 9
```
9 failures ≤ 11 baseline. ✓

**quay-github:**
```
ℹ tests 21
ℹ pass 21
ℹ fail 0
```
21/21/0. ✓

### 5. Import-resolution check

`packages/quay/src/mcp-server.js` updated:
```js
import { runGate } from "./gate/engine.ts";
import { resolveGateLogPath, runGateLogQuery } from "./gate/gate-log.ts";
import { runComplete, runAdjudicate, runPromote, runRetreat, assertTransition } from "./gate/lifecycle.ts";
```

`packages/quay/bin/quay.js` updated:
```js
import { runGate } from "../src/gate/engine.ts";
import { listGates } from "../src/gate/registry.ts";
import { resolveGateLogPath, runGateLogQuery } from "../src/gate/gate-log.ts";
import { runComplete, runAdjudicate, runPromote, runRetreat } from "../src/gate/lifecycle.ts";
import { runOnce, runLoop } from "../src/gate/driver.ts";
```

13 test/*.mjs files updated to import from .ts extensions (all dynamic imports and static imports updated).

### 6. All 7 gate/ .ts files present

```
packages/quay/src/gate/acceptance-runner.ts
packages/quay/src/gate/driver.ts
packages/quay/src/gate/engine.ts
packages/quay/src/gate/gate-event-store.ts
packages/quay/src/gate/gate-log.ts
packages/quay/src/gate/lifecycle.ts
packages/quay/src/gate/registry.ts
```

No `.js` files remain in `packages/quay/src/gate/`.

**HARD GATES:** manda healthz gate: N/A. port-4173 reachability gate: N/A.
(No Web UI surface touched in this milestone.)
