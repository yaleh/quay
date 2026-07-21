---
id: exp5-M-TS-MIGRATION-P3-A
title: "TS migration P3-A: port quay-native package to TypeScript"
status: ready
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION-P3
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-TS-MIGRATION-P3-A
    experiments/quay-perpetual-stream/charters/M80-ts-migration-p3a.md
    /tmp/m80-absorb-entry.md
---
## Context

Part of the ADR-012 TS migration program. P3 is the per-package internal migration phase. P3-A covers `packages/quay-native/` — the native file-system provider.

Files in scope (3 files, ~1013 lines):
- `packages/quay-native/src/manifest.js` (~17 lines)
- `packages/quay-native/src/mcp-server.js` (~233 lines)
- `packages/quay-native/src/store.js` (~763 lines)

ABI interfaces (`Task`, `AdrRecord`, `Manifest`) are already defined in `packages/quay/src/abi.ts` (M79). The `ProviderClient` interface in `packages/quay/src/provider-client.ts` expresses the typed contract. This milestone wires quay-native's internal `.js` to use those types.

## Acceptance Criteria

- [ ] All 3 `.js` files in `packages/quay-native/src/` ported to `.ts` with named types (no `any` on public-facing shapes)
- [ ] `npx tsc --noEmit` exits 0 across the repo
- [ ] Test suite baseline maintained: 342/338/4 (or better)
- [ ] No runtime behavior change (golden-diff discipline)

## Definition of Done

- [ ] `packages/quay-native/src/*.ts` files exist (replacing `.js` counterparts)
- [ ] `tsc --noEmit` exits 0
- [ ] Test suite 338/342 pass (≥98.8%)
- [ ] Acceptance gate PASS

## Notes

- Cross-package import: quay-native imports from quay-core's abi.ts — ensure package.json/tsconfig paths resolve correctly
- `store.js` is the largest file (763 lines) — may need per-module split if ceiling exceeded
- `null as unknown as Task` casts from P2 audit: investigate whether these can be cleaned in P3-A scope
