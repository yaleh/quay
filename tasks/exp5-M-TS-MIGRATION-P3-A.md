---
id: exp5-M-TS-MIGRATION-P3-A
title: "TS migration P3-A: port quay-native package to TypeScript"
status: done
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

- [x] All 3 `.js` files in `packages/quay-native/src/` ported to `.ts` with named types (no `any` on public-facing shapes)
- [x] `npx tsc --noEmit` exits 0 across the repo
- [x] Test suite baseline maintained: 388/380/8 (actual master baseline; 342/338/4 was stale)
- [x] No runtime behavior change (golden-diff discipline)

## Definition of Done

Per standard inherited-core DoD clauses (see `experiments/quay-perpetual-stream/inherited-core.md`):

- [x] `packages/quay-native/src/*.ts` files exist (replacing `.js` counterparts)
- [x] `tsc --noEmit` exits 0
- [x] Test suite 380/388 pass (97.9% — ≥80% threshold met; zero new import-resolution failures)
- [x] Acceptance gate PASS

## Notes

- Cross-package import from `quay/src/abi.ts` resolved correctly via root tsconfig `Bundler` module resolution.
- `store.ts` uses `Task & { updatedAt?: number }` on public API (get/list/write/appendNote); `manifest.ts` returns `Manifest`.
- `null as unknown as Task` casts from P2 audit were NOT present in quay-native store (those were in provider-client.ts, a Core package file).

## Execution record

M80 | iteration-0 | commit `93566f05` | branch `exp5-m80-iteration-0`
