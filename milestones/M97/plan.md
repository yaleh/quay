# Plan M97 — startMcpServer god-function decomposition (ARCH-M93-002)

**Task:** ARCH-M93-002  
**Charter:** experiments/quay-perpetual-stream/charters/M97-startmcpserver-decompose.md  
**Type:** development-class / defect (architecture)  
**Planned:** 2026-07-22

## Adjudication summary

**Proposal A** (per-domain files): extracts handlers into `mcp-handlers/` subdirectory. Achieves outDegree reduction but adds 5 new files + shared-binding threading across module boundaries.

**Proposal B** (same-file function extraction): extracts handlers into named `register*` functions within `mcp-server.ts`. Archguard entity-level analysis tracks cross-file entity calls only (confirmed by M93 evidence: 10 out-edges are all cross-file calls). Same-file `register*` functions do NOT count toward `startMcpServer`'s outDegree → outDegree drops to ~2 (just `loadConfig` + `QUAY_VERSION`). Simpler, zero import changes, zero circular-import risk.

**Adjudicated approach: Proposal B (same-file extraction).** `startMcpServer` body shrinks from ~695 lines to ~60 lines. No new files created. All 15 handlers remain registered via their existing `server.tool(...)` calls. Post-implementation archguard verification required.

## Stage 1 — Extract handler bodies into named register* functions (one atomic commit)

### Handler groups and line ranges (current mcp-server.ts, 808 lines)

| Group | Handlers (count) | Current line range |
|---|---|---|
| task | task_list, task_get, task_write, task_check (4) | ~218–395 |
| gate | gate_run, gate_log (2) | ~417–503 |
| lifecycle | lifecycle_complete, lifecycle_adjudicate, lifecycle_promote, lifecycle_retreat (4) | ~506–627 |
| adr | adr_list, adr_get, adr_write (3) | ~629–688 |
| action | action_list, action_run (2) | ~700–787 |

### Refactored startMcpServer body (skeleton)

```ts
export async function startMcpServer(): Promise<void> {
  // setup: cfg, enabledIds, defaultId, clients Map, getClient closure, McpServer instance
  // ... (lines ~102–131 kept verbatim) ...

  // resource registrations: provider://manifest + per-provider aliases
  // ... (lines ~136–166 kept verbatim) ...

  registerTaskHandlers(server, getClient);
  registerGateHandlers(server, getClient, cfg);
  registerLifecycleHandlers(server, getClient, cfg);
  registerAdrHandlers(server, getClient);
  registerActionHandlers(server, getClient, cfg, defaultId);

  // transport connect + startup log + onclose cleanup
  // ... (lines ~789–807 kept verbatim) ...
}
```

### Five new functions (defined below startMcpServer in mcp-server.ts)

Each function receives only the bindings it needs:
- **`registerTaskHandlers(server, getClient)`** — moves task_list/get/write/check handler bodies. Internalizes `stripHeadings` (currently at ~line 184, used only here). Uses file-local `QUAY_VERSION` directly (no need to pass as parameter — it's a module-level import already in scope).
- **`registerGateHandlers(server, getClient, cfg)`** — moves gate_run/gate_log handler bodies. The `process.env` save/restore pattern in gate_run must stay intact (copy verbatim).
- **`registerLifecycleHandlers(server, getClient, cfg)`** — moves all 4 lifecycle handler bodies.
- **`registerAdrHandlers(server, getClient)`** — moves adr_list/get/write handler bodies (thinnest group, pure passthrough).
- **`registerActionHandlers(server, getClient, cfg, defaultId)`** — moves action_list/action_run handler bodies.

### TypeScript type annotations

`getClient` closure type: `(providerId: string | undefined) => Promise<ConnectedProvider>`. The `ConnectedProvider` interface is already at file scope. Each `register*` function declares this type explicitly for its `getClient` parameter.

`cfg` parameter type: `ReturnType<typeof loadConfig>` (same pattern as `connectToProvider` at line ~80).

### QENG comment block (lines ~397–411)

The multi-paragraph comment explaining gate/lifecycle tool convention ("a gate/lifecycle FAIL is a normal SUCCESSFUL tool call reporting ok:false") moves into `registerGateHandlers` as a function-level comment. Do NOT orphan it in `startMcpServer`.

### Section header comments (e.g. lines ~629–631 for ADR block)

Each domain section header comment moves into the corresponding `register*` function body.

### Atomicity constraint

ONE commit. The tests spawn `quay mcp` as a subprocess — they can only run against a complete binary. A partial migration is not meaningful as a commit. All 5 `register*` functions + the reduced `startMcpServer` body land together.

### Line budget

| File | Change |
|---|---|
| `packages/quay/src/mcp-server.ts` | `startMcpServer` body shrinks ~635 lines → ~60 lines (−575); 5 new `register*` functions add ~600 lines back. Net file change ≈ +0 (reorganization). |

No new files. No import changes. No test changes.

## Stage 2 — Verification before committing

1. TypeScript compilation: `cd packages/quay && npx tsc --noEmit` — must exit 0.
2. Test suite: `node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')` — all blocks pass.
3. Archguard re-run: `archguard_summary({ projectRoot: "/home/yale/work/quay" })` — `startMcpServer` outDegree ≤ 4 (target ~2). Paste output.

## Stage 3 — Prose (task update, audit artifact)

Update `tasks/ARCH-M93-002.md`: check AC/DoD boxes.  
Write `/tmp/m97-absorb-entry.md`.  
Write adversarial audit in `milestones/M97/audits/`.

## Plan check

**Round 1:**

**Gap 1:** `stripHeadings` is currently a local function at ~line 184. After extraction, it needs to be accessible to `registerTaskHandlers`. Options: (a) make it a module-level function (hoisted above both `startMcpServer` and `registerTaskHandlers`), or (b) define it inside `registerTaskHandlers`. Option (a) is cleaner — `stripHeadings` is already module-scoped in intent. Keep it as a module-level function.

**Gap 2:** The `QUAY_VERSION` import is at the top of `mcp-server.ts` and used in the task_list handler. After extraction, it is still in scope for `registerTaskHandlers` as a module-level binding. No parameter threading needed. ✓

**Gap 3:** Does the `getClient` closure close over `defaultId`? Yes — the closure body checks `providerId ?? defaultId`. So `defaultId` is already captured by the closure. `registerActionHandlers` does NOT need to receive `defaultId` as a parameter — `getClient` already handles the fallback. The task handlers that pass `provider` from the tool call input just pass it through to `getClient`. ✓ (Proposal B overstated the need for explicit `defaultId` parameter; the closure handles it.)

**Gap 4:** `registerGateHandlers` uses `cfg.workspaceRoot` for `resolveGateLogPath` and the QUAY_ACCEPTANCE_CWD env-var pin. Passing `cfg` by value is safe since it's a plain object parsed at startup. ✓

F_i after round 1: 1 (Gap 3 — simplifies `registerActionHandlers` signature)

**Round 2:**

Revised `registerActionHandlers` signature: `(server, getClient, cfg)` — `defaultId` dropped (captured by `getClient` closure).

Revised `startMcpServer` delegation:
```ts
registerActionHandlers(server, getClient, cfg);
```

F_i = 0. Plan is complete and grounded.
