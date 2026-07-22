# Charter M100-startserver-decompose — startServer god-function decomposition (ARCH-M93-003)

**Milestone id:** M100  
**Task:** `tasks/ARCH-M93-003.md` (milestone-candidate)  
**Surface:** `packages/quay/src/serve.ts` — decompose `startServer` route handlers into named functions  
**Type:** development-class / defect (architecture)  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

`startServer` in `packages/quay/src/serve.ts` is a 675-line function body (lines 411–1085) containing 5 route handlers inlined directly in one function scope: `GET /` (task list), `GET /adr` (ADR list), `GET /adr/:id` (ADR detail), `GET /task/:id` (task detail), `POST /task/:id/action/:actionId` (action trigger). The function is the 2nd-highest outDegree entity in the codebase (outDegree=6 per M93 archguard).

This is the same god-function pattern fixed for `startMcpServer` at M97/M99: extract handler bodies into named functions so the routing function becomes a thin dispatcher.

**Lesson from M97/M99:** When extracting to a companion file (`mcp-handlers.ts`), archguard counts each cross-file entity import as a separate outDegree edge. Using a `handleAll(req, client, cfg)` facade pattern (as done for `registerAllHandlers` at M99) keeps the final outDegree low. Apply the same approach here.

## Scope

**In scope:**

1. Extract the 5 route handler bodies from `startServer` into named handler functions (either in `serve.ts` below `startServer` or in a companion `serve-handlers.ts`). Each handler receives `(req: Request, client: ProviderClient, cfg: ..., url: URL) => Promise<Response>`.
2. `startServer` becomes a thin dispatcher: receives HTTP request, resolves provider, routes to the appropriate named handler via `url.pathname` matching.
3. Verify: total `serve.ts` (or combined `serve.ts + serve-handlers.ts`) is ≤600 lines, `startServer` body ≤80 lines. Archguard outDegree ≤4.
4. All existing web UI tests pass (if any in `packages/quay/test/`). If no web UI tests exist, document this in the ABSORB entry.

**Adjudication:** Same-file extraction (following M97 pattern → then learned: companion file is fine too). The key constraint is NOT to split into more than ONE companion file, to keep the facade pattern working. Prefer: named functions in `serve.ts` below `startServer` (simplest, zero import changes, same-file outDegree counting behavior).

**Out of scope:**
- ARCH-M93-001 (gate/ god-package)
- Changing route semantics, URL patterns, or HTML output
- Security logic (`isSafeRelativeRedirect`) — keep in place

## Class routing

**Development-class** — code change in `packages/quay/src/`. Requires quay-task-to-plan (N=2 proposals → adjudication → plan → executor). Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] `startServer` body ≤80 lines (thin dispatcher); route handler logic extracted into named handler functions. `serve.ts` total ≤600 lines (or combined with companion ≤1100 lines with cleaner structure).
- [ ] All existing tests pass (web UI smoke if any; no test regressions).
- [ ] Archguard re-run shows `startServer` outDegree ≤4 (was 6). Pasted output.

## Definition of Done

- [ ] `startServer` body ≤80 lines; archguard outDegree ≤4 (global scope, noCache=true); pasted.
- [ ] Tests pass. If no web UI tests: document and add at least one smoke-level test for route dispatch.
- [ ] Fresh-context adversarial audit confirms no route behavior regression.
- [ ] Per DIR-026 SPLIT-OR-COMMIT: decomposition lands done-or-`needs-human`.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
