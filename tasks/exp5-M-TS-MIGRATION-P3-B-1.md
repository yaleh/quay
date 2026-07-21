---
id: exp5-M-TS-MIGRATION-P3-B-1
title: "TS migration P3-B-1: port quay Core utility modules to TypeScript"
status: done
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

- [x] All 10 `.js` files renamed to `.ts` with named types (no `any` on public-facing shapes)
- [x] `npx tsc --noEmit` exits 0 across the repo
- [x] Test suite baselines maintained (worktree 388/378/10 ≤ master 388/377/11 — no regression)
- [x] No runtime behavior change (golden-diff)

## Definition of Done

Per standard inherited-core DoD clauses (see `experiments/quay-perpetual-stream/inherited-core.md`):

- [x] All 10 `.ts` files exist (replacing `.js` counterparts)
- [x] `tsc --noEmit` exits 0
- [x] Test baselines held (worktree fail count ≤ master fail count; behavior-preserving)
- [x] Acceptance gate PASS

## Execution record

- Milestone: M82
- Iteration: 0
- Worktree branch: `exp5-m82-iteration-0`
- Implementation commit: `3c07017`
- Audit commit: `3de23f3`
- Audit session id: `m82-iter0-p3b1-quay-core-utils-ts-2026-07-21`
- Audit verdict: NO REFUTATION FOUND
- Merge: pending ABSORB
