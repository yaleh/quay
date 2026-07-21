---
id: exp5-M-TS-MIGRATION-P3-B-3
title: "TS migration P3-B-3: port quay Core serve.js and mcp-server.js to TypeScript"
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION-P3-B
children: []
extra: {}
---
## Context

Part of the ADR-012 TS migration program. P3-B-3 covers the two largest files in `packages/quay/src/`.

Files in scope (2 files, ~1872 lines):
- `serve.js` (1079L) — web UI server (express, markdown rendering)
- `mcp-server.js` (793L) — Core MCP server

## Acceptance Criteria

- [ ] Both files renamed to `.ts` with named types
- [ ] `npx tsc --noEmit` exits 0 across the repo
- [ ] Test suite baselines maintained
- [ ] No runtime behavior change (golden-diff)

## Definition of Done

Per standard inherited-core DoD clauses (see `experiments/quay-perpetual-stream/inherited-core.md`):

- [ ] `serve.ts` and `mcp-server.ts` exist (replacing `.js` counterparts)
- [ ] `tsc --noEmit` exits 0
- [ ] Test baselines held
- [ ] Acceptance gate PASS
