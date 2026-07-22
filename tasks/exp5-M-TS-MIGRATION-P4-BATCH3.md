---
id: exp5-M-TS-MIGRATION-P4-BATCH3
title: "TS migration P4 Batch 3: vendor-copy scripts .mjs→.ts + sync-vendor.sh
  update + plugin SKILL.md refs + version bump"
status: todo
labels:
  - milestone-candidate
parent: exp5-M-TS-MIGRATION-P4
children: []
extra: {}
---

## Finding

P4 Batch 3: the 9 vendor-copy scripts in `experiments/quay-perpetual-stream/scripts/` (mirrored to `plugin/scripts/` via `sync-vendor.sh`). Requires: rename source scripts, update `sync-vendor.sh` copy commands, re-run vendor sync, update SKILL.md references, bump plugin version.

**Scope (9 scripts):**
- `anti-drift-touches-check.mjs` → `.ts`
- `concurrent-batch-scheduler.mjs` → `.ts`
- `read-probe-spec.mjs` → `.ts`
- `routine-file-gate.mjs` → `.ts`
- `routine-scheduler.mjs` → `.ts`
- `serial-fanin-absorb.mjs` → `.ts`
- `task-schema.mjs` → `.ts`
- `task-schema-check.mjs` → `.ts`
- `touches-orthogonality-check.mjs` → `.ts`

**Reference updates required:**
- `plugin/scripts/sync-vendor.sh`: update 7 `.mjs` → `.ts` copy lines
- `plugin/skills/loop-driver/SKILL.md`: 6 `.mjs` references → `.ts`
- `plugin/skills/quay-directive/SKILL.md`: 1 `.mjs` reference → `.ts`
- `plugin/.claude-plugin/plugin.json`: version bump 0.3.19 → 0.3.20
- Re-run `bash plugin/scripts/sync-vendor.sh` to sync `plugin/scripts/` to `.ts`

**Not in scope:** `it0-dod-check.mjs` (Batch 4), test runner `.test.mjs` files.

## Acceptance Criteria

- [ ] All 9 vendor-copy scripts renamed `.mjs` → `.ts` in `experiments/quay-perpetual-stream/scripts/`; old `.mjs` files deleted.
- [ ] `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json` exits 0.
- [ ] `sync-vendor.sh` updated to copy `.ts` files; `bash plugin/scripts/sync-vendor.sh` runs without error; `plugin/scripts/` now contains `.ts` files (old `.mjs` deleted).
- [ ] All active `.mjs` references to the 9 scripts updated to `.ts` (loop-driver/SKILL.md, quay-directive/SKILL.md, plugin.json version bumped).
- [ ] `it0-dod-check.mjs` untouched: `sha256sum` = `33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`.

## Definition of Done

Standard inherited-core DoD clauses apply. Task-specific criteria:

- [ ] All 9 source scripts `.ts`; `tsc --noEmit` exit 0; old `.mjs` deleted.
- [ ] Vendor sync complete: `plugin/scripts/` has `.ts` copies; `sync-vendor.sh` is the single writer (ADR-004).
- [ ] SKILL.md refs updated: no stale `.mjs` references to the 9 migrated scripts in plugin/skills/.
- [ ] Plugin version bumped to 0.3.20 in `plugin/.claude-plugin/plugin.json`.
- [ ] GATE-HASH-REF unchanged (sha256 match confirmed).
- [ ] it0 DoD meta-enforcer passes all clauses.

## Proposal

N/A — mechanical migration batch; no design required.

## Plan

N/A — per parent task's SPLIT-OR-COMMIT plan: rename, type-check, sync, update refs.
