# Charter M85-ts-migration-p3b3 — TS migration P3-B-3: serve.js and mcp-server.js

**Milestone id:** M85  
**Task:** `tasks/exp5-M-TS-MIGRATION-P3-B-3.md` (milestone-candidate, crystallization)  
**Surface:** `packages/quay/src/serve.js` (1079L) + `packages/quay/src/mcp-server.js` (793L)  
**Type:** capability-growth (L_C hardening, ADR-012) + governance-integrity  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

P3-B-3 is the final child of P3-B. P3-B-1 (M82) ported utilities, P3-B-2 (M84) ported gate/. This milestone completes the `packages/quay/src/` TypeScript migration (only `bin/quay.js` entry point remains as JS after this).

**M83 archguard audit findings (grounding this milestone):**

`serve.js` (1079L) imports:
- `node:http`, `node:path` (stdlib)
- `./config.ts`, `./provider-client.ts`, `./provider-env.ts` (already migrated)
- Risk: LOW

`mcp-server.js` (793L) imports:
- `@modelcontextprotocol/sdk/server/mcp.js` + `stdio.js` (npm)
- `zod` (npm)
- `node:path` (stdlib)
- `./config.ts`, `./provider-client.ts`, `./action.ts`, `./provider-env.ts`, `./version.ts` (already migrated)
- `./gate/engine.ts`, `./gate/gate-log.ts`, `./gate/lifecycle.ts` (migrated in M84)
- Risk: MEDIUM (npm types for MCP SDK/zod; gate/ now .ts — prerequisite satisfied)

## Scope

**In-scope work:**

1. Rename `serve.js → serve.ts`; remove any `@ts-nocheck`; add type annotations on exported functions and request-handler shapes; use `Task` from `abi.ts` where task objects are rendered.

2. Rename `mcp-server.js → mcp-server.ts`; remove any `@ts-nocheck`; add type annotations on MCP tool handler functions; the MCP SDK's `McpServer` and `z` from zod are already typed — let TypeScript infer where possible; for the `task_write` handler's input validation, the zod schema already provides inference.

3. Update all import references to these files from `.js → .ts`:
   - `packages/quay/bin/quay.js` (imports from serve and mcp-server)
   - `packages/quay-native/src/mcp-server.ts` (may reference quay's mcp-server)
   - Any test files importing serve.js or mcp-server.js

**Behavior-preserving constraints:**
- NO runtime logic changes. Type annotations only.
- `tsc --noEmit` GREEN (exit 0) across the repo.
- Test baselines: quay + quay-native ≤ 11 failures (master: 388/377/11); quay-github 21/21/0.
- Golden-diff: zero behavior change.

**Out of scope:**
- `bin/quay.js` entry point TS migration (P4 scope or separate decision)
- Any runtime logic change
- Restructuring MCP tool definitions

## Value hypothesis

- **Y:** `serve.ts` and `mcp-server.ts` exist; `tsc --noEmit` exits 0; baselines held
- **Δv̂ = 0** (L_C internal hardening, no cov-cell change)
- **Value type:** capability-growth (L_C hardening, ADR-012) + governance-integrity

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** 2 files, 1872 lines total. Under 2000-line ceiling. serve.js at 1079L is the larger file but is a single functional unit (HTTP server).

**(b) gate-hash (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

**(c) dogfooding evidence gate:** N/A at charter time.

**(d) domain-misfit audit-channel:** N/A — deliverables are `.ts` source files.

**(e) plan-time line-budget gate:** ~1872 lines in scope. No declared budget > 2000. Single-pass feasible by precedent from P3-B-1 (965L) and P3-B-2 (1316L).

**Sizing:** 2 files, 1872 lines total. serve.js is larger but simpler (HTTP server + markdown rendering, no complex DSL); mcp-server.js has MCP SDK types which are well-defined. Should land clean in iteration-0.

## Class routing

**Development-class** (deliverable = `.ts` implementation files). Direct to implementation.

## Done-when (binary)

1. Both files exist as `.ts`: `packages/quay/src/serve.ts`, `packages/quay/src/mcp-server.ts`. Paste `ls packages/quay/src/*.ts | grep -E "serve|mcp-server"`.
2. No `@ts-nocheck` in either renamed `.ts` file. Paste `grep -l "@ts-nocheck" packages/quay/src/serve.ts packages/quay/src/mcp-server.ts` (should be empty).
3. `npx tsc --noEmit` exits 0. Paste exit code.
4. quay + quay-native tests: ≤ 11 failures (master baseline 388/377/11). Paste `ℹ tests / ℹ pass / ℹ fail`.
5. quay-github tests: 21 tests, 21 pass, 0 fail. Paste `ℹ tests / ℹ pass / ℹ fail`.
6. All consumers of serve.js and mcp-server.js updated to import `.ts`: `bin/quay.js`, any test files.

## Inner termination (§3.2)

1. All 6 Done-when confirmed.
2. ΔV < 0.02 both layers, K=2 consecutive.
3. Ceiling exceeded → `needs-human`.
4. Past budget ~10 iterations.
5. External HALT.
6. `tsc` reveals broad unexpected type errors in MCP SDK usage → `needs-human`.

## HARD GATES (by-reference):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI logic changes — serve.ts is a rename+type-only, not a behavior change). State N/A explicitly.

## Per-milestone acceptance audit (UNCONDITIONAL)

Specific charge:
1. Run `npx tsc --noEmit` — confirm exit 0.
2. Read both `serve.ts` and `mcp-server.ts` — confirm no `@ts-nocheck`, public shapes typed.
3. Confirm no `any` on MCP tool handler function signatures.
4. Run both test suites — confirm ≤11 failures and 21/21/0; paste output.
5. Confirm zero import-resolution failures (check bin/quay.js).

Output to `milestones/M85/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-TS-MIGRATION-P3-B-3 experiments/quay-perpetual-stream/charters/M85-ts-migration-p3b3.md /tmp/m85-absorb-entry.md`
- `quay gate exp5-M-TS-MIGRATION-P3-B-3`
- Worktree: `milestones/M85/worktrees/iteration-0` off master HEAD
- milestone_counter: do NOT increment until all gates clear
- Dashboard row: `m85 · exp5-M-TS-MIGRATION-P3-B-3 · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M85/`
- No Web UI verification required (no behavior change — rename+type-only)
- VT Δ = 0
