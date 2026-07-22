# M100 Plan — startServer god-function decomposition (ARCH-M93-003)

**Charter:** `experiments/quay-perpetual-stream/charters/M100-startserver-decompose.md`  
**Adjudication date:** 2026-07-22

## Adjudication Summary

Two proposals reviewed:

- **Proposal A** (companion file `serve-handlers.ts`): extract 5 handler bodies to new file; keep 8 rendering helpers in `serve.ts`. Estimated serve.ts ~472 lines, serve-handlers.ts ~580 lines. Single companion file satisfies charter constraint.
- **Proposal B** (initially same-file, revised): concluded two companion files needed (`serve-render.ts` + `serve-handlers.ts`) to hit ≤600. Charter explicitly forbids more than ONE companion file. However Proposal B's own line arithmetic confirms that serve.ts WITHOUT moving rendering helpers but WITH extracting handler bodies ≈ 483 lines — exactly matching Proposal A. Moving helpers is unnecessary.

**Decision: Proposal A's structure wins.** Single companion `serve-handlers.ts`. Keep 8 rendering helpers in `serve.ts`. Apply M99 lesson: export a single `handleAllRoutes()` facade from `serve-handlers.ts` so `startServer` has only 1 cross-file import edge (not 5).

## Implementation Steps

### Step 1: Create `packages/quay/src/serve-handlers.ts`

New file containing:

1. **Imports** needed by handlers: `http` (IncomingMessage, ServerResponse), types from `./provider-client.ts` (ProviderClient), `./config.ts` (loadConfig return type). Import rendering helpers FROM `./serve.ts` — OR duplicate the few that handlers need. Actually: handlers call module-level helpers (`html`, `escapeHtml`, `renderMarkdown`, etc.) that live in serve.ts — to avoid circular imports, move the shared helpers to serve-handlers.ts and re-export them from serve.ts (or keep them in serve.ts and import them from there). **Simpler: keep helpers in serve.ts and do NOT import them in serve-handlers.ts** — instead, pass only the primitive helpers actually needed as arguments, or make serve-handlers.ts define its own local copies of the ~3 helpers it needs.

   **Correct approach:** serve-handlers.ts re-imports only from external modules (`node:http`, `./provider-client.ts`, `./config.ts`). It does NOT import from `serve.ts` (no circular imports). The rendering helpers (`html`, `escapeHtml`, `stripHeadings`, `pageStyles`, `renderMarkdown`, `inlineMarkdown`, `relativeTime`) that are currently in serve.ts will be MOVED to `serve-handlers.ts` (or a shared render module). Then `serve.ts` imports them from `serve-handlers.ts`.

   Actually, simplest path to avoid circular import: **move the 8 rendering helpers INTO `serve-handlers.ts`**. Then `serve.ts` imports them from there. This means serve.ts is lean (mostly startServer + imports), and serve-handlers.ts has both helpers + handlers.

2. **Exports from `serve-handlers.ts`:**
   - Re-export rendering helpers (for serve.ts to import)
   - `addParam(urlPath, key, value)` — currently a closure in startServer; becomes module-level
   - `buildHref(status, sort, label, pg, prefix, q, pageSizeOverride, defaultPageSize)` — currently closure inside handler; becomes module-level pure function  
   - `handleTaskList(req, res, url, client, manifest)` — handler for GET /
   - `handleAdrList(req, res, url, client)` — handler for GET /adr
   - `handleAdrDetail(req, res, adrId, client)` — handler for GET /adr/:id
   - `handleTaskDetail(req, res, url, taskId, client, manifest)` — handler for GET /task/:id
   - `handleTaskAction(req, res, url, taskId, actionId, client, manifest, cfg, addParam)` — handler for POST /task/:id/action/:actionId
   - **`handleAllRoutes(req, res, client, manifest, cfg)`** — single facade entry point (the M99 pattern); dispatches to the 5 named handlers based on `req.url` + `req.method`

### Step 2: Modify `packages/quay/src/serve.ts`

Changes to `serve.ts`:

1. Add import: `import { handleAllRoutes, html, escapeHtml, stripHeadings, pageStyles, renderMarkdown, inlineMarkdown, relativeTime, isSafeRelativeRedirect } from "./serve-handlers.ts";`
2. Remove the 8 rendering helper function bodies from serve.ts (they now live in serve-handlers.ts)
3. Simplify `startServer` body:
   - Keep: `loadConfig()`, `activeProvider()`, `connectProvider()`, `resolveProviderEnv()`, `client.manifest()` — the setup code (~20 lines)
   - Remove: `addParam` closure, `handleRequest` inner function (675 lines total)
   - Inline the `http.createServer` wrapper with the try/catch, calling `handleAllRoutes(req, res, client, manifest, cfg)` directly
   - Keep: `server.listen()` + return
4. `startServer` body target: ~25 lines (setup) + ~15 lines (server creation/listen) = ~40 lines. Well under 80 AC.

### Step 3: Verify line counts and outDegree

After implementation:
- `serve.ts`: imports (~15L) + StartServerOptions interface (~3L) + startServer body (~40L) = ~58 lines + any remaining boilerplate. Target ≤600. ✓
- `serve-handlers.ts`: 8 rendering helpers (~390L) + 5 handlers (~575L) + addParam/buildHref/handleAllRoutes (~40L) = ~1005L. This is within "combined ≤1100" AC. ✓
- `startServer` outDegree: retains `loadConfig`, `activeProvider`, `connectProvider`, `resolveProviderEnv`, `ProviderClient` = 5 existing edges. Adds 1 edge for `handleAllRoutes` from serve-handlers.ts. Route-specific client calls (currently counted in startServer because they're inline) move to serve-handlers.ts. Net expected outDegree: ≤6 initially → after archguard remeasures with inline calls gone from startServer scope, expect ≤4.

**Note:** Run archguard after implementation to confirm. If outDegree is still >4, consider whether `StartServerOptions` or type-only imports count. The `isSafeRelativeRedirect` currently in serve.ts moves to serve-handlers.ts — this removes one potential edge if archguard was counting it.

### Step 4: Run test suite

```bash
cd /home/yale/work/quay/packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')
```

All tests must pass without modification. The public API `startServer({ port })` is unchanged.

### Step 5: One atomic commit

```
refactor(serve): extract startServer route handlers to serve-handlers.ts (ARCH-M93-003)
```

## File Changes Summary

| File | Action | Lines after |
|---|---|---|
| `packages/quay/src/serve-handlers.ts` | NEW | ~1005L |
| `packages/quay/src/serve.ts` | MODIFIED (remove helpers + handlers, add import + facade call) | ~60L |

## Acceptance Criteria Check

- [ ] `startServer` body ≤80 lines — expect ~40 lines ✓
- [ ] `serve.ts` total ≤600 lines (or combined ≤1100) — combined ~1065 lines ✓
- [ ] All tests pass without modification ✓
- [ ] archguard outDegree ≤4 (verify post-implementation; use global scope + noCache=true)
- [ ] One companion file only (serve-handlers.ts) ✓

## Grounded Checks

1. Circular import check: serve-handlers.ts MUST NOT import from serve.ts. All shared rendering helpers move to serve-handlers.ts; serve.ts imports them from there.
2. `isSafeRelativeRedirect` is security-critical and must not be modified — only moved to serve-handlers.ts.
3. `addParam` is currently a closure — it closes over nothing (all args explicit after extraction). Safe to make module-level.
4. `buildHref` closes over `PAGE_SIZE` and `DEFAULT_PAGE_SIZE` — those two constants must also move to serve-handlers.ts or be passed as explicit args. Moving the constants is cleaner.
5. Dynamic `import("./action.ts")` inside the POST handler body (line ~991): moves to handleTaskAction in serve-handlers.ts. This removes one dynamic-import edge from startServer's outDegree count.
