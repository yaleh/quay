---
id: exp5-M-TS-MIGRATION-P3-C
title: "TS migration P3-C: port quay-github package to TypeScript"
status: done
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION-P3
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-TS-MIGRATION-P3-C
    experiments/quay-perpetual-stream/charters/M81-ts-migration-p3c.md
    /tmp/m81-absorb-entry.md
---
## Context

Part of the ADR-012 TS migration program. P3-C covers `packages/quay-github/` — the GitHub Issues provider.

Files ported (3 files, ~1254 lines):
- `packages/quay-github/src/manifest.js` (16 lines) → `manifest.ts`
- `packages/quay-github/src/mcp-server.js` (310 lines) → `mcp-server.ts`
- `packages/quay-github/src/github-client.js` (928 lines) → `github-client.ts`

## Acceptance Criteria

- [x] All `.js` files in `packages/quay-github/src/` ported to `.ts` with named types (no `@ts-nocheck`)
- [x] `npx tsc --noEmit` exits 0 across the repo
- [x] Test suite baselines held: quay+quay-native 388/380/8; quay-github 21/21/0
- [x] No runtime behavior change (golden-diff discipline)

## Definition of Done

Per standard inherited-core DoD clauses (see `experiments/quay-perpetual-stream/inherited-core.md`):

- [x] `packages/quay-github/src/*.ts` files exist (replacing `.js` counterparts)
- [x] `tsc --noEmit` exits 0
- [x] Test suites at or above baselines (380/388 pass, 97.9%; quay-github 21/21 pass, 100%)
- [x] Acceptance gate PASS

## Notes

- `Task` from `abi.ts` used in `github-client.ts`: `issueToViewModel()` returns `Task`; `list()` returns `Task[]`; `get()`, `setStatus()`, `create()` return `Task | null`.
- `Manifest` from `abi.ts` used in `manifest.ts`: `readManifest()` returns `Manifest`.
- Local interfaces `TaskLike` and `ChildStatusEntry` added to support typed recursion in `github-client.ts`.
- `task-check-passthrough.test.mjs` adversarial break/restore tests updated from `github-client.js` → `.ts`.

## Execution record

M81 | iteration-0 | commit `78ec9631` | branch `exp5-m81-iteration-0`
