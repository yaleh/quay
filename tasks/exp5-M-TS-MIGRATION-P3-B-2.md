---
id: exp5-M-TS-MIGRATION-P3-B-2
title: "TS migration P3-B-2: port quay Core gate/ subdirectory to TypeScript"
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION-P3-B
children: []
extra: {}
---
## Context

Part of the ADR-012 TS migration program. P3-B-2 covers the `packages/quay/src/gate/` subdirectory — the QENG gate engine.

Files in scope (7 files, ~1316 lines):
- `gate/engine.js` (54L)
- `gate/gate-log.js` (62L)
- `gate/acceptance-runner.js` (70L)
- `gate/gate-event-store.js` (88L)
- `gate/driver.js` (130L)
- `gate/lifecycle.js` (216L)
- `gate/registry.js` (696L) — the largest, multi-gate routing

## Acceptance Criteria

- [ ] All 7 `.js` files in `gate/` renamed to `.ts` with named types
- [ ] `npx tsc --noEmit` exits 0 across the repo
- [ ] Test suite baselines maintained
- [ ] No runtime behavior change (golden-diff)

## Definition of Done

Per standard inherited-core DoD clauses (see `experiments/quay-perpetual-stream/inherited-core.md`):

- [ ] All 7 `gate/*.ts` files exist (replacing `.js` counterparts)
- [ ] `tsc --noEmit` exits 0
- [ ] Test baselines held
- [ ] Acceptance gate PASS
