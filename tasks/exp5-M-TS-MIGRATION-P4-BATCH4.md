---
id: exp5-M-TS-MIGRATION-P4-BATCH4
title: "TS migration P4 Batch 4: it0-dod-check.mjs→.ts + GATE-HASH-REF rotation
  + task-schema shim cleanup"
status: done
labels:
  - milestone-candidate
parent: exp5-M-TS-MIGRATION-P4
children: []
extra: {}
---

## Finding

P4 Batch 4: the final and most sensitive migration — `it0-dod-check.mjs` (the DoD meta-enforcer itself) renamed to `.ts`. Requires: GATE-HASH-REF rotation (new sha256 of `it0-dod-check.ts` replaces `33de7b...` in inherited-core.md and future charters), cleanup of the `task-schema.mjs` re-export shim (created in Batch 3), update of `it0-dod-check.sh` wrapper, prose reference updates in inherited-core.md and OUTER-LOOP.md.

**Scope:**
- `it0-dod-check.mjs` → `it0-dod-check.ts` (git mv)
- Update import in `it0-dod-check.ts`: `./task-schema.mjs` → `./task-schema.ts`
- Delete `task-schema.mjs` shim (no longer needed post-import-fix)
- Update `it0-dod-check.sh` wrapper: line calling `it0-dod-check.mjs` → `it0-dod-check.ts`
- Update prose references: `inherited-core.md` (~12 refs), `OUTER-LOOP.md` (~6 refs)
- Compute new GATE-HASH-REF: `sha256sum experiments/quay-perpetual-stream/scripts/it0-dod-check.ts`
- Update `inherited-core.md` GATE-HASH-REF documentation to reference `it0-dod-check.ts`
- Document new GATE-HASH-REF value; all future charters will pin the new hash

**Not in scope:** test runner `.test.mjs` files, exp3/exp4 legacy `it0-gate-hash-check.sh` mechanism.

## Acceptance Criteria

- [x] `it0-dod-check.mjs` renamed to `it0-dod-check.ts`; old `.mjs` deleted; `it0-dod-check.sh` wrapper updated to invoke `it0-dod-check.ts`.
- [x] Import in `it0-dod-check.ts` updated from `./task-schema.mjs` → `./task-schema.ts`; `task-schema.mjs` re-export shim deleted.
- [x] `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json` exits 0.
- [x] New GATE-HASH-REF computed and documented (`sha256sum it0-dod-check.ts`); all active prose references to `it0-dod-check.mjs` in inherited-core.md and OUTER-LOOP.md updated to `it0-dod-check.ts`.
- [x] DoD gate (`it0-dod-check.sh`) still passes — runs `it0-dod-check.ts` correctly under Node native type-stripping.

## Definition of Done

Standard inherited-core DoD clauses apply. Task-specific criteria:

- [x] `it0-dod-check.ts` runs correctly: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh <any-milestone-id> <charter> <absorb-entry>` exits 0 on a known-good test run.
- [x] Old `it0-dod-check.mjs` deleted, `task-schema.mjs` shim deleted; no orphaned imports.
- [x] New GATE-HASH-REF documented in charter's `GATE-HASH-REF:` line for this milestone AND stated in ABSORB entry for future orchestrators.
- [x] `inherited-core.md` updated to reference `it0-dod-check.ts`; OUTER-LOOP.md prose refs updated.
- [x] it0 DoD meta-enforcer (now `.ts`) passes all clauses on the Batch 4 milestone itself.

## Proposal

N/A — mechanical migration; no design required.

## Plan

N/A — per parent task's SPLIT-OR-COMMIT plan: rename, fix import, delete shim, update wrapper, update prose refs, compute new hash.
