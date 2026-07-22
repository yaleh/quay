# Charter M97-startmcpserver-decompose — startMcpServer god-function decomposition (ARCH-M93-002)

**Milestone id:** M97  
**Task:** `tasks/ARCH-M93-002.md` (milestone-candidate)  
**Surface:** `packages/quay/src/mcp-server.ts` — decompose `startMcpServer` into per-domain handler groups  
**Type:** development-class / defect (architecture)  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

`startMcpServer` in `packages/quay/src/mcp-server.ts` (808 lines) is the highest-outDegree entity in the codebase (outDegree=10 per archguard M93). It registers all 15 MCP tool handlers inline in a single 695-line function body: `task_list`, `task_get`, `task_write`, `task_check`, `gate_run`, `gate_log`, `lifecycle_complete`, `lifecycle_adjudicate`, `lifecycle_promote`, `lifecycle_retreat`, `adr_list`, `adr_get`, `adr_write`, `action_list`, `action_run`. There is no domain grouping or handler extraction.

**Impact:** adding a tool, auditing a handler, or changing a schema requires navigating 808 lines of mixed concerns. The structural load shows directly in the archguard score (outDegree=10 = rank 1 in codebase).

**Fix direction (adjudication to settle):** Extract handler implementations into per-domain handler functions or files (e.g. task handlers, gate handlers, lifecycle handlers, ADR handlers, action handlers). `startMcpServer` becomes a thin registration wrapper that delegates to these groups. The 15 `server.tool(...)` calls remain; only their inlined bodies move out.

## Scope

**In scope:**

Two implementation options:
- **Option A (inline handler extraction):** Extract handler bodies into named handler functions within `mcp-server.ts` (or a small parallel file `mcp-handlers.ts` imported by `mcp-server.ts`). `startMcpServer` calls these functions for each tool's handler. Files stay in `packages/quay/src/`.
- **Option B (per-domain files):** Split into domain-specific files: `packages/quay/src/mcp-task-handlers.ts`, `packages/quay/src/mcp-gate-handlers.ts`, `packages/quay/src/mcp-adr-handlers.ts`, `packages/quay/src/mcp-action-handlers.ts`. Each exports a `registerXxxHandlers(server, provider)` function called by `startMcpServer`.

Adjudicator selects the option that reduces `startMcpServer` outDegree to ≤4 and passes the full existing test suite.

Scope boundary:
1. Extract handler implementations from `startMcpServer` body.
2. Preserve all 15 tool registrations, their schemas, and their response formats exactly (behavior-preserving refactor).
3. Verify: `archguard_summary` re-run shows `startMcpServer` outDegree ≤4.
4. All existing tests in `packages/quay/test/mcp-server.test.mjs` pass without change.

**Out of scope:**
- ARCH-M93-001 (gate/ god-package), ARCH-M93-003 (startServer god-function) — separate milestones.
- Adding new tool handlers or changing handler logic.
- `packages/quay-native/src/mcp-server.ts` (a separate file, not part of this finding).
- Client-facing behavior changes: schemas, response formats, error messages must be unchanged.

## Class routing

**Development-class** — code change in `packages/quay/src/`. MUST go through `quay-task-to-plan` pipeline (N=2 independent blank-slate proposals → adjudication → write-back → plan author → grounded check rounds → converge) BEFORE dispatch to `baime:iteration-executor`. Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] `startMcpServer` body is decomposed: handler implementations extracted into named handler functions/modules; `startMcpServer` becomes a thin registration wrapper (body ≤ ~80 lines).
- [ ] All 15 MCP tool handlers still work correctly; `packages/quay/test/mcp-server.test.mjs` passes with zero changes to test code.
- [ ] Archguard re-run shows `startMcpServer` outDegree ≤4 (was 10). Pasted output confirms.

## Definition of Done

References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] `startMcpServer` body reduced to ≤80 lines; archguard outDegree ≤4 confirmed with pasted output.
- [ ] Full test suite passes (`node --test packages/quay/test/mcp-server.test.mjs`) — no regressions.
- [ ] TDD per ADR-001: existing mcp-server tests confirm behavior preservation; no test edits needed (behavior is unchanged).
- [ ] Fresh-context adversarial audit confirms no handler behavior changes (schemas, responses, error handling unchanged).
- [ ] Per DIR-026 SPLIT-OR-COMMIT: the decomposition lands done-or-`needs-human`.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`  
(SHA-256 of `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` at charter time — the iteration-0 agent MUST verify this matches before running gates)
