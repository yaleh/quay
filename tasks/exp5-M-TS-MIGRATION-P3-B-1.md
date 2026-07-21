---
id: exp5-M-TS-MIGRATION-P3-B-1
title: "TS migration P3-B-1: port quay Core utility modules to TypeScript"
status: ready
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION-P3-B
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-TS-MIGRATION-P3-B-1
    experiments/quay-perpetual-stream/charters/M82-ts-migration-p3b1.md
    /tmp/m82-absorb-entry.md
---
## Context

Part of the ADR-012 TS migration program. P3-B-1 covers the small utility modules in `packages/quay/src/` — all files with <200 lines, none requiring `@ts-nocheck`.

Files in scope (10 files, ~965 lines):
- `version.js` (17L) — exports version string
- `provider-env.js` (32L) — environment variable helpers
- `config.js` (55L) — workspace config reader
- `contract-validator.js` (60L) — ABI contract validation
- `migrate.js` (80L) — migration utilities
- `frontmatter-store-base.js` (114L) — base class for frontmatter stores
- `action.js` (124L) — action dispatch logic
- `document-store.js` (131L) — document/file store
- `loop-params.js` (169L) — loop parameter parsing
- `adr-store.js` (183L) — ADR (decision record) store

## Acceptance Criteria

- [ ] All 10 `.js` files renamed to `.ts` with named types (no `any` on public-facing shapes)
- [ ] `npx tsc --noEmit` exits 0 across the repo
- [ ] Test suite baselines maintained
- [ ] No runtime behavior change (golden-diff)

## Definition of Done

Per standard inherited-core DoD clauses (see `experiments/quay-perpetual-stream/inherited-core.md`):

- [ ] All 10 `.ts` files exist (replacing `.js` counterparts)
- [ ] `tsc --noEmit` exits 0
- [ ] Test baselines held
- [ ] Acceptance gate PASS
