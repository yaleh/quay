---
id: exp5-M-TS-MIGRATION-P3-B-2
title: "TS migration P3-B-2: port quay Core gate/ subdirectory to TypeScript"
status: ready
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION-P3-B
children: []
extra:
  schema: "v1"
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-TS-MIGRATION-P3-B-2
    experiments/quay-perpetual-stream/charters/M84-ts-migration-p3b2.md
    /tmp/m84-absorb-entry.md
---
## Context

Part of the ADR-012 TS migration program. P3-B-2 covers the `packages/quay/src/gate/` subdirectory — the QENG gate engine. This is the second child of P3-B; P3-B-1 (M82) already ported the utility modules.

Files in scope (7 files, ~1316 lines):
- `gate/engine.js` (54L) — gate evaluation orchestrator
- `gate/gate-log.js` (62L) — gate event log reader
- `gate/acceptance-runner.js` (70L) — shell-command acceptance gate runner
- `gate/gate-event-store.js` (88L) — immutable gate event persistence (JSONL)
- `gate/driver.js` (130L) — CLI driver for gate subcommands
- `gate/lifecycle.js` (216L) — task lifecycle transitions (todo→ready→done, needs-human)
- `gate/registry.js` (696L) — multi-gate routing DSL (highest complexity target)

**M83 archguard audit findings (grounding this milestone):**
- No cycles in gate/ internal graph (clean DAG)
- External imports per file: stdlib only (fs, path, crypto, child_process, url) + yaml npm + 4 already-migrated TS modules (in registry.js)
- Risk: leaf files (acceptance-runner, gate-event-store, gate-log, driver) LOW; registry.js MEDIUM (696 lines, complex gate DSL)
- mcp-server.js (P3-B-3 scope) imports 3 gate/ files → P3-B-2 must land BEFORE P3-B-3

## Proposal

Golden-diff rename `.js → .ts` for all 7 gate/ files. Remove any `@ts-nocheck` directives. Add TypeScript type annotations on exported functions and gate-definition DSL types. Leverage types from `abi.ts` where functions accept `Task` or gate-event shapes. Update all import references that point to these files from `.js → .ts`.

This is behavior-preserving: no runtime logic changes, type annotations only. Node 25 strips types at runtime.

## Plan

N/A — single-pass implementation (behavior-preserving TS port, like P3-B-1). Worktree agent performs the migration in one iteration-0 pass.

## Acceptance Criteria

- [ ] All 7 `gate/` `.js` files renamed to `.ts` with named types (no `any` on public-facing shapes)
- [ ] `npx tsc --noEmit` exits 0 across the repo
- [ ] Test suite baselines maintained (fail count ≤ pre-migration master baseline)
- [ ] No runtime behavior change (golden-diff)

## Definition of Done

Per standard inherited-core DoD clauses (see `experiments/quay-perpetual-stream/inherited-core.md`):

- [ ] All 7 `gate/*.ts` files exist (replacing `.js` counterparts)
- [ ] `tsc --noEmit` exits 0
- [ ] Test baselines held (fail count ≤ master baseline)
- [ ] Acceptance gate PASS
