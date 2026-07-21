---
id: exp5-M-TS-MIGRATION-P3-B-3
title: "TS migration P3-B-3: port quay Core serve.js and mcp-server.js to TypeScript"
status: ready
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION-P3-B
children: []
extra:
  schema: "v1"
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-TS-MIGRATION-P3-B-3
    experiments/quay-perpetual-stream/charters/M85-ts-migration-p3b3.md
    /tmp/m85-absorb-entry.md
---
## Context

Part of the ADR-012 TS migration program. P3-B-3 covers the two largest files in `packages/quay/src/` — the web UI server and the Core MCP server. This is the final child of P3-B; P3-B-1 (M82) ported utilities, P3-B-2 (M84) ported gate/.

Files in scope (2 files, ~1872 lines):
- `serve.js` (1079L) — web UI server (node:http + markdown rendering + task list/detail views)
- `mcp-server.js` (793L) — Core MCP server (@modelcontextprotocol/sdk + zod + gate/ + TS modules)

**M83 archguard audit findings:**
- `serve.js`: 5 imports total (node:http, node:path + 3 already-migrated TS modules). Risk: LOW.
- `mcp-server.js`: 12 imports (MCP SDK, zod, node:path, 5 TS modules, 3 gate/ files now .ts after M84). Risk: MEDIUM (npm types for MCP SDK/zod may need care).

**Prerequisites satisfied:** P3-B-2 (gate/) merged in M84 — all gate/ imports in mcp-server.js now reference `.ts` files.

## Proposal

Golden-diff rename `serve.js → serve.ts` and `mcp-server.js → mcp-server.ts`. Remove any `@ts-nocheck` directives. Add TypeScript type annotations on exported functions and key internal shapes. Leverage types from `abi.ts` where handler functions accept `Task` shapes. For MCP SDK and zod usage in mcp-server.ts, the SDK types are already available; use them where zod schemas produce typed objects.

This is behavior-preserving: no runtime logic changes, type annotations only.

## Plan

N/A — single-pass implementation (behavior-preserving TS port, like P3-B-1 and P3-B-2). Worktree agent performs the migration in one iteration-0 pass.

## Acceptance Criteria

- [ ] Both files renamed to `.ts` (`serve.ts`, `mcp-server.ts`) with named types (no `any` on public-facing shapes)
- [ ] `npx tsc --noEmit` exits 0 across the repo
- [ ] Test suite baselines maintained (fail count ≤ master baseline)
- [ ] No runtime behavior change (golden-diff)

## Definition of Done

Per standard inherited-core DoD clauses (see `experiments/quay-perpetual-stream/inherited-core.md`):

- [ ] `serve.ts` and `mcp-server.ts` exist (replacing `.js` counterparts)
- [ ] `tsc --noEmit` exits 0
- [ ] Test baselines held (fail count ≤ master baseline)
- [ ] Acceptance gate PASS
