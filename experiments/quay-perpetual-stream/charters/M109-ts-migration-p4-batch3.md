# Charter M109-ts-migration-p4-batch3 — TS migration P4 Batch 3: vendor-copy scripts

**Milestone id:** M109  
**Task:** `tasks/exp5-M-TS-MIGRATION-P4-BATCH3.md` (milestone-candidate, child of exp5-M-TS-MIGRATION-P4)  
**Surface:** method-infra (non-product-touching)  
**Type:** crystallization / capability-growth (ADR-012)  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

P4 Batch 3: migrate the 9 vendor-copy method-infra scripts from `.mjs` to TypeScript. These scripts live in both `experiments/quay-perpetual-stream/scripts/` (canonical source) and `plugin/scripts/` (vendored copies managed by `sync-vendor.sh`).

**Why vendor-copy scripts are their own batch:**
- `sync-vendor.sh` hardcodes `.mjs` extension in all copy commands
- SKILL.md files in `plugin/skills/` reference `.mjs` paths at runtime
- Plugin version bump (0.3.19→0.3.20) needed to signal the extension change to consumers
- More reference locations than Batches 1+2 (which had no plugin coupling)

**Completed batches:**
- M106 Batch 1: 9 non-vendor, non-pinned scripts → `.ts` ✓
- M107 Batch 2: 7 non-vendor remaining scripts → `.ts` ✓
- **M109 Batch 3: 9 vendor-copy scripts → `.ts` (this milestone)**
- M110+ Batch 4: `it0-dod-check.mjs` + GATE-HASH-REF rotation (deferred)

## Scope

**9 scripts to migrate:**
1. `anti-drift-touches-check.mjs` → `.ts`
2. `concurrent-batch-scheduler.mjs` → `.ts`
3. `read-probe-spec.mjs` → `.ts`
4. `routine-file-gate.mjs` → `.ts`
5. `routine-scheduler.mjs` → `.ts`
6. `serial-fanin-absorb.mjs` → `.ts`
7. `task-schema.mjs` → `.ts`
8. `task-schema-check.mjs` → `.ts`
9. `touches-orthogonality-check.mjs` → `.ts`

**Steps:**
1. For each script: `git mv experiments/quay-perpetual-stream/scripts/<name>.mjs experiments/quay-perpetual-stream/scripts/<name>.ts`
2. Run `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json` — fix any type errors
3. Update `plugin/scripts/sync-vendor.sh`: change all 9 `.mjs` → `.ts` in copy commands (lines copying these scripts)
4. Re-run `bash plugin/scripts/sync-vendor.sh` to populate `plugin/scripts/` with `.ts` files; old `.mjs` files will remain until explicitly deleted
5. Delete old `.mjs` files from `plugin/scripts/` (9 files)
6. Update SKILL.md references:
   - `plugin/skills/loop-driver/SKILL.md`: 6 references (concurrent-batch-scheduler, anti-drift-touches-check, serial-fanin-absorb, routine-scheduler, read-probe-spec, routine-file-gate)
   - `plugin/skills/quay-directive/SKILL.md`: 1 reference (task-schema-check)
7. Bump version in `plugin/.claude-plugin/plugin.json`: `"version": "0.3.19"` → `"version": "0.3.20"`
8. Verify GATE-HASH-REF unchanged: `sha256sum experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs`
9. Run full test suite: `cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')`

**Not in scope:**
- `it0-dod-check.mjs` (Batch 4 — GATE-HASH-REF rotation required)
- Test runner `.test.mjs` files (not method-infra scripts)
- Any change to script logic/verdicts (language port only)

## Class routing

**Crystallization / capability-growth (ADR-012 L_C hardening)**. Development-class iteration — quay-task-to-plan was NOT required (Batch 3 is a direct continuation of M106/M107 with the same pattern; no new design). Dispatch directly.

## Acceptance Criteria

- [ ] All 9 vendor-copy scripts renamed `.mjs` → `.ts` in `experiments/quay-perpetual-stream/scripts/`; old `.mjs` files deleted.
- [ ] `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json` exits 0.
- [ ] `sync-vendor.sh` updated to copy `.ts` files; `bash plugin/scripts/sync-vendor.sh` runs without error; `plugin/scripts/` now contains `.ts` files (old `.mjs` deleted).
- [ ] All active `.mjs` references to the 9 scripts updated to `.ts` (loop-driver/SKILL.md, quay-directive/SKILL.md, plugin.json version bumped to 0.3.20).
- [ ] `it0-dod-check.mjs` untouched: `sha256sum` = `33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`.

## Definition of Done

- [ ] All 9 source scripts `.ts`; `tsc --noEmit` exit 0; old `.mjs` deleted.
- [ ] Vendor sync complete: `plugin/scripts/` has `.ts` copies; `sync-vendor.sh` is the single writer (ADR-004).
- [ ] SKILL.md refs updated: no stale `.mjs` references to the 9 migrated scripts in plugin/skills/.
- [ ] Plugin version bumped to 0.3.20 in `plugin/.claude-plugin/plugin.json`.
- [ ] GATE-HASH-REF unchanged (sha256 match confirmed).
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
