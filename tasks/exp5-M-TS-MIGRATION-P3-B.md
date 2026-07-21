---
id: exp5-M-TS-MIGRATION-P3-B
title: "TS migration P3-B: port quay Core package internals to TypeScript"
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION-P3
children: []
extra: {}
---
## Context

Part of the ADR-012 TS migration program. P3-B covers `packages/quay/src/` internal `.js` files — the Core package excluding already-ported files (`provider-client.ts`, `abi.ts`).

Files in scope (multiple .js files in packages/quay/src/):
- gate/ subdirectory (engine.js, registry.js, etc.)
- serve.js, mcp-server.js, and other src files

## Acceptance Criteria

- [ ] All `.js` files in `packages/quay/src/` ported to `.ts` with named types
- [ ] `npx tsc --noEmit` exits 0 across the repo
- [ ] Test suite baseline maintained: 342/338/4 (or better)
- [ ] No runtime behavior change (golden-diff discipline)

## Definition of Done

- [ ] `packages/quay/src/*.ts` files exist (replacing `.js` counterparts)
- [ ] `tsc --noEmit` exits 0
- [ ] Test suite 338/342 pass (≥98.8%)
- [ ] Acceptance gate PASS

## Notes

- Largest scope of the three P3 sub-milestones — may need further per-module split at SELECT
- Dependency on P3-A: if quay Core imports from quay-native, P3-A should land first
- Check ceiling (≤2000 lines of changes) at charter time; split further if needed
