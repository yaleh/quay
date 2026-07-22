# Charter M99-startmcpserver-outDegree-fix — startMcpServer outDegree fix (PROBE-M98-001)

**Milestone id:** M99  
**Task:** `tasks/PROBE-M98-001.md` (milestone-candidate, defect)  
**Surface:** `packages/quay/src/mcp-handlers.ts` + `packages/quay/src/mcp-server.ts`  
**Type:** development-class / defect  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

M97 (ARCH-M93-002) decomposed `startMcpServer` from 797-line god-function into a 187-line thin wrapper + 672-line `mcp-handlers.ts`. The M97 AC required `startMcpServer` outDegree ≤4. However, the M97 executor measured outDegree=0 using a narrow-scope analysis that undercounted cross-file dependencies within the same package. The M98 mandatory explore (fresh archguard, global scope, noCache=true) correctly measured outDegree=7.

**The 7 outgoing dependencies of `startMcpServer`:**
1. `config.ts.loadConfig`
2. `mcp-handlers.ts.ConnectedProvider` (type reference)
3. `mcp-handlers.ts.registerTaskHandlers`
4. `mcp-handlers.ts.registerGateHandlers`
5. `mcp-handlers.ts.registerLifecycleHandlers`
6. `mcp-handlers.ts.registerAdrHandlers`
7. `mcp-handlers.ts.registerActionHandlers`

To reach outDegree ≤4, the 5 separate `register*` calls must be consolidated into fewer cross-file entity calls.

## Scope

**Fix approach (adjudication to settle):**

- **Option A (single facade):** Add `registerAllHandlers(server: McpServer, getClient: GetClient, cfg: ReturnType<typeof loadConfig>): void` to `mcp-handlers.ts`. This function calls all 5 `register*` functions internally. `startMcpServer` calls only `registerAllHandlers` instead of 5 separate calls. Reduces outDegree to: `loadConfig` (1) + `ConnectedProvider` (1) + `registerAllHandlers` (1) = 3. ✓ meets ≤4.
- **Option B (drop type reference):** Bundle Option A + move `ConnectedProvider` type import to use `ReturnType<typeof connectToProvider>` or inline the type in `mcp-server.ts`, reducing to 2. More invasive.

Adjudicator selects Option A: minimal change (add one facade function, update 5 call sites to 1), preserves all existing `register*` functions for future individual use, no behavior change.

**In scope:**
1. Add `registerAllHandlers(server, getClient, cfg)` to `mcp-handlers.ts` (calls the 5 existing `register*` functions).
2. In `mcp-server.ts`, replace the 5 separate `register*` calls with `registerAllHandlers(server, getClient, cfg)`. Remove the 5 separate imports (keep only `registerAllHandlers` + `ConnectedProvider`).
3. Verify archguard outDegree ≤4 with fresh measurement (global scope, noCache=true).
4. All existing `mcp-server.test.mjs` tests pass without change.

**Out of scope:**
- Changing handler behavior or schemas
- Removing the individual `register*` exports (keep them for individual callers)
- Any other structural changes

## Class routing

**Development-class** — code change in `packages/quay/src/`. Requires quay-task-to-plan (N=2 proposals → adjudication → plan → executor). Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] `startMcpServer` outDegree ≤ 4 confirmed by fresh archguard analysis (global scope, noCache:true). Pasted output.
- [ ] All 15 MCP tool handlers still work correctly; `mcp-server.test.mjs` passes.
- [ ] `registerAllHandlers()` exported from `mcp-handlers.ts`; `startMcpServer` uses it instead of 5 separate calls.

## Definition of Done

- [ ] Archguard outDegree ≤4 confirmed (global scope, noCache:true); pasted output shows all 7 dependencies eliminated to ≤4.
- [ ] Full test suite passes (`node --test packages/quay/test/mcp-server.test.mjs`).
- [ ] Fresh-context adversarial audit confirms no handler behavior regression.
- [ ] Per DIR-026 SPLIT-OR-COMMIT: fix lands done-or-`needs-human`.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
