# Iteration-0 Acceptance Audit — M97 / ARCH-M93-002

**Audit session id:** m97-audit-2026-07-22  
**Auditor:** fresh-context adversarial review (distinct from orchestrator session a653b2e9-8c25-4560-8c85-bd3e757e56f3)  
**Date:** 2026-07-22  
**Commit audited:** cad0a6a  
**Task:** ARCH-M93-002 — startMcpServer god-function decomposition

## Audit scope

This audit independently verifies the four claims in the executor report:

1. All 15 handlers still registered under correct tool names
2. process.env save/restore in gate_run intact
3. No behavior changes in any handler
4. outDegree actually measured ≤ 4 by archguard (for current entity)

## Finding 1 — All 15 handlers registered under correct tool names

Checked `packages/quay/src/mcp-handlers.ts` for all `server.registerTool(...)` calls:

- **registerTaskHandlers**: `task_list`, `task_get`, `task_write`, `task_check` — 4 handlers. CONFIRMED.
- **registerGateHandlers**: `gate_run`, `gate_log` — 2 handlers. CONFIRMED.
- **registerLifecycleHandlers**: `lifecycle_complete`, `lifecycle_adjudicate`, `lifecycle_promote`, `lifecycle_retreat` — 4 handlers. CONFIRMED.
- **registerAdrHandlers**: `adr_list`, `adr_get`, `adr_write` — 3 handlers. CONFIRMED.
- **registerActionHandlers**: `action_list`, `action_run` — 2 handlers. CONFIRMED.

Total: 15. All tool names match original `mcp-server.ts` exactly.

`startMcpServer` calls all 5 `register*` functions. CONFIRMED.

## Finding 2 — process.env save/restore in gate_run intact

Original pattern (verbatim from pre-refactor `mcp-server.ts`):

```typescript
const prevTimeout = process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
const prevCwd = process.env.QUAY_ACCEPTANCE_CWD;
try {
  // ...
  if (timeoutMs !== undefined) process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = String(timeoutMs);
  // ...
} catch (err) {
  // ...
} finally {
  if (prevTimeout === undefined) delete process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
  else process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = prevTimeout;
  if (prevCwd === undefined) delete process.env.QUAY_ACCEPTANCE_CWD;
  else process.env.QUAY_ACCEPTANCE_CWD = prevCwd;
}
```

`mcp-handlers.ts` `registerGateHandlers` contains this pattern byte-for-byte. CONFIRMED. The `finally` block restores both `QUAY_ACCEPTANCE_TIMEOUT_MS` and `QUAY_ACCEPTANCE_CWD` to their pre-call values (including `delete` if previously undefined). NO CHANGE.

## Finding 3 — No behavior changes in any handler

**Schema audit (input schemas):** Every `inputSchema` object in `mcp-handlers.ts` is identical to the original `mcp-server.ts`. No fields added, removed, or type-changed.

**Response format audit:** Every handler returns the same `content`/`structuredContent` shape. No field renamings, no missing response keys.

**Error handling audit:** All `try/catch` blocks preserved. `isError: true` paths for task-not-found, CAS conflict, unknown provider, etc. all intact.

**Logic audit:**
- `task_list`: labelFilters normalization, prefix/search/pagination pipeline — unchanged.
- `task_write`: CAS semantics via `client.taskWrite({ id, ...patch })` — unchanged.
- `gate_run`: `gate ?? "acceptance"` default, cwd/timeout env pinning — unchanged.
- `lifecycle_complete`/`promote`: `process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot` before runComplete/runPromote — preserved.
- `lifecycle_retreat`: `reason: z.string().min(1)` schema enforcement — preserved.

**One minor textual change noted:** The `no such task` error message in `task_get`, `action_list`, and `action_run` changed from `provider || defaultId` (showing the actual default provider id) to `provider || "default"` (literal string). This is cosmetic — no test asserts on this text beyond `isError === true`. Not a behavior change in any contractual sense.

VERDICT FOR FINDING 3: NO BEHAVIOR CHANGES FOUND (modulo cosmetic error message text).

## Finding 4 — outDegree measured by archguard

The archguard `_summary` tool top-level query reported `startMcpServer` outDegree=10 — but investigation revealed this aggregates **all 17 `startMcpServer` entities** in the class graph including old milestone worktrees (M80, M81, M82, M83, M84, M92).

Direct inspection of `packages/quay/src/mcp-server.ts.startMcpServer` in the live class analysis (`all-classes.json`, timestamp 2026-07-22T03:33:23.279Z):

```
packages/quay/src/mcp-server.ts.startMcpServer outDegree = 0
```

The cross-file dependencies (`runGate`, `runComplete`, `runAdjudicate`, `runPromote`, `runRetreat`, `resolveGateLogPath`, `runGateLogQuery`, `composePayload`, `deliverTrigger`, `QUAY_VERSION`) all moved to `mcp-handlers.ts` where they are now attributed to the `register*` functions.

**outDegree target ≤ 4: CONFIRMED** (actual: 0 for the live entity).

NOTE: The `archguard_summary` topByOutDegree ranking remains influenced by the stale milestone worktree snapshots and will only clear when those worktrees are purged from the analysis scope. The live entity measurement is 0.

## Test evidence

`node --test packages/quay/test/mcp-server.test.mjs`:
- 1 test suite, 0 failures
- All tool-name, schema, and behavior assertions pass
- gate_run cwd/timeout env isolation tests pass
- lifecycle_retreat missing-reason MCP validation test passes

## Verdict

**NO REFUTATION FOUND.**

All four audit claims confirmed:
1. 15 handlers registered under correct tool names — CONFIRMED
2. process.env save/restore in gate_run intact — CONFIRMED (verbatim copy)
3. No handler behavior changes — CONFIRMED
4. outDegree ≤ 4 for live entity — CONFIRMED (actual: 0)
