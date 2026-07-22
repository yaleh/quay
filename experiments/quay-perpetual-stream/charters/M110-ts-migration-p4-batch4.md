# Charter M110-ts-migration-p4-batch4 — TS migration P4 Batch 4: it0-dod-check.mjs→.ts + GATE-HASH-REF rotation

**Milestone id:** M110  
**Task:** `tasks/exp5-M-TS-MIGRATION-P4-BATCH4.md` (milestone-candidate, child of exp5-M-TS-MIGRATION-P4)  
**Surface:** method-infra (non-product-touching)  
**Type:** crystallization / capability-growth (ADR-012)  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

P4 Batch 4: the final TS migration batch — `it0-dod-check.mjs` (the DoD meta-enforcer itself) renamed to `.ts`. This closes the ADR-012 P4 program.

**Completed batches:**
- M106 Batch 1: 9 non-vendor, non-pinned scripts → `.ts` ✓
- M107 Batch 2: 7 non-vendor remaining scripts → `.ts` ✓
- M109 Batch 3: 9 vendor-copy scripts → `.ts` + plugin v0.3.20 ✓
- **M110 Batch 4: `it0-dod-check.mjs` → `.ts` + GATE-HASH-REF rotation (this milestone)**

**Why Batch 4 is separate:**
- `it0-dod-check.mjs` is the gate enforcer itself — the most sensitive migration
- GATE-HASH-REF pinned in all previous charters (`33de7b...`) must be rotated to the new sha256
- The `task-schema.mjs` re-export shim (created in Batch 3) can be deleted once `it0-dod-check.ts` imports `./task-schema.ts` directly

## Pre-flight check

At dispatch time (before any changes), verify:
```
sha256sum experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs
```
Expected: `33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`

This confirms the gate enforcer is the pinned version.

## Scope

**Steps:**

1. `git mv experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs experiments/quay-perpetual-stream/scripts/it0-dod-check.ts`

2. Update the import in `it0-dod-check.ts`:
   - Find: `import ... from "./task-schema.mjs"` (or `require("./task-schema.mjs")`)
   - Replace with: `from "./task-schema.ts"` (or `require("./task-schema.ts")`)
   - This eliminates the need for the `task-schema.mjs` re-export shim

3. `git rm experiments/quay-perpetual-stream/scripts/task-schema.mjs` (delete the shim created in Batch 3)

4. Update `experiments/quay-perpetual-stream/scripts/it0-dod-check.sh` wrapper:
   - Line 31: `node "$(dirname "$0")/it0-dod-check.mjs"` → `node "$(dirname "$0")/it0-dod-check.ts"`
   - Update comment on line 3: `delegating to it0-dod-check.mjs` → `delegating to it0-dod-check.ts`

5. Run `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json` — fix any type errors

6. Compute new GATE-HASH-REF:
   ```
   sha256sum experiments/quay-perpetual-stream/scripts/it0-dod-check.ts
   ```
   Record this value — it becomes the new GATE-HASH-REF for all future charters.

7. Update prose references in `experiments/quay-perpetual-stream/inherited-core.md`:
   - Replace `it0-dod-check.mjs` → `it0-dod-check.ts` (~12 occurrences)
   - Update GATE-HASH-REF documentation to note: "new GATE-HASH-REF = sha256 of `it0-dod-check.ts`"

8. Update prose references in `experiments/quay-perpetual-stream/OUTER-LOOP.md`:
   - Replace `it0-dod-check.mjs` → `it0-dod-check.ts` in prose descriptions (~6 occurrences)
   - Do NOT change invocations of `it0-dod-check.sh` (those use the wrapper, not `.mjs` directly)

9. Scan for any remaining stale `.mjs` references to `it0-dod-check`:
   ```
   grep -r "it0-dod-check\.mjs" experiments/ .quay/ packages/ 2>/dev/null | grep -v charters/ | grep -v milestones/
   ```
   Fix any active-path hits.

10. Run DoD gate smoke test (verify `it0-dod-check.ts` works end-to-end):
    ```
    bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-TS-MIGRATION-P4-BATCH4 \
      experiments/quay-perpetual-stream/charters/M110-ts-migration-p4-batch4.md \
      /tmp/m110-absorb-entry.md
    ```

**Not in scope:**
- Test runner `.test.mjs` files
- exp3/exp4 `it0-gate-hash-check.sh` mechanism (different hash check, different era)
- Historical charter files (they correctly reference the old hash; no retroactive update)

## Class routing

**Crystallization / capability-growth (ADR-012 L_C hardening)**. Dispatch directly — same pattern as Batches 1-3.

## Acceptance Criteria

- [ ] `it0-dod-check.mjs` renamed to `it0-dod-check.ts`; old `.mjs` deleted; `it0-dod-check.sh` wrapper updated to invoke `it0-dod-check.ts`.
- [ ] Import in `it0-dod-check.ts` updated from `./task-schema.mjs` → `./task-schema.ts`; `task-schema.mjs` re-export shim deleted.
- [ ] `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json` exits 0.
- [ ] New GATE-HASH-REF computed and documented (`sha256sum it0-dod-check.ts`); all active prose references to `it0-dod-check.mjs` in inherited-core.md and OUTER-LOOP.md updated to `it0-dod-check.ts`.
- [ ] DoD gate (`it0-dod-check.sh`) still passes — runs `it0-dod-check.ts` correctly under Node native type-stripping.

## Definition of Done

- [ ] `it0-dod-check.ts` runs correctly: DoD gate smoke test exits 0 on known-good inputs.
- [ ] Old `it0-dod-check.mjs` deleted, `task-schema.mjs` shim deleted; no orphaned imports.
- [ ] New GATE-HASH-REF documented in this charter's `GATE-HASH-REF:` line AND in ABSORB entry.
- [ ] `inherited-core.md` updated to reference `it0-dod-check.ts`; OUTER-LOOP.md prose refs updated.
- [ ] it0 DoD meta-enforcer (now `.ts`) passes all clauses on this Batch 4 milestone itself.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
