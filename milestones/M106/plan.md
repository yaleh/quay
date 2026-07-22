# M106 Plan — TS migration P4 Batch 1 (non-vendor method-infra scripts)

**Charter:** `experiments/quay-perpetual-stream/charters/M106-ts-migration-p4-batch1.md`  
**Adjudication date:** 2026-07-22  
**Type:** development-class / crystallization

## Adjudication

Both proposals agree on the migration mechanics. Key adjudication choices:

- **tsconfig approach**: Proposal A's per-directory `tsconfig.json` at `experiments/quay-perpetual-stream/scripts/tsconfig.json` (more contained than touching root config)
- **loadbearing-test-gate self-reference**: Proposal B correctly identifies that `enumerateScripts` filters `.mjs` and `hasSiblingTest` strips `.mjs` — both must be updated to handle `.ts` as part of this migration (required correctness fix, not scope creep)
- **Reference location list**: Proposal B's is slightly more complete; used as the authoritative list
- **it0-dod-check.mjs**: both agree — untouched; its references to `audit-independence-check.mjs` must NOT change
- **Typing strategy**: minimal, concentrated on exported function signatures and config object shapes

## In-scope scripts

| Script | Selfcheck fixture |
|---|---|
| `audit-independence-check.mjs` | `audit-independence-selfcheck.sh` |
| `governance-product-ratio-check.mjs` | `governance-product-ratio-selfcheck.sh` |
| `loadbearing-test-gate.mjs` | `loadbearing-test-gate-selfcheck.sh` |
| `outward-vt-check.mjs` | `outward-vt-selfcheck.sh` |
| `rolling-slope-check.mjs` | `rolling-slope-selfcheck.sh` |
| `vmeta-lag-check.mjs` | `vmeta-lag-selfcheck.sh` |
| `git-lens-l-d-code-doc-ratio.mjs` | `git-lens-selfcheck.sh` (covers all 3) |
| `git-lens-l-g-structural-drift.mjs` | (same) |
| `git-lens-l-s-behavior-variance.mjs` | (same) |

## Steps

1. **Capture pre-migration golden baselines**: run all 7 selfchecks (6 individual + git-lens-selfcheck) and save stdout+stderr+exit-code to `/tmp/selfcheck-before-<name>.txt`. Do this BEFORE any rename.

2. **Add per-directory tsconfig**: create `experiments/quay-perpetual-stream/scripts/tsconfig.json`:
   ```json
   {
     "extends": "../../../tsconfig.json",
     "compilerOptions": { "noEmit": true },
     "include": ["*.ts"],
     "exclude": []
   }
   ```
   Verify `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json` passes on unmodified repo (baseline 0 files, no errors).

3. **Migrate 9 scripts**: for each script in scope:
   - `mv scripts/foo.mjs scripts/foo.ts`
   - Add TypeScript type annotations to exported function signatures and config object shapes
   - Special: for `loadbearing-test-gate.ts`, also update `enumerateScripts` to match `.ts` files (change `endsWith(".mjs")` to `endsWith(".ts") || endsWith(".mjs")`) and update `hasSiblingTest` to strip both extensions

4. **Update all reference locations**:

   **Shell wrapper scripts** (`.mjs` → `.ts` in node invocations):
   - `scripts/audit-independence-check.sh`: `node "$(dirname "$0")/audit-independence-check.mjs"` → `.ts`
   - `scripts/vmeta-lag-check.sh`: `node "$(dirname "$0")/vmeta-lag-check.mjs"` → `.ts`
   - `scripts/loadbearing-test-gate.sh`: `node "$(dirname "$0")/loadbearing-test-gate.mjs"` → `.ts`

   **Selfcheck scripts** (CHK variables and direct node invocations):
   - `scripts/governance-product-ratio-selfcheck.sh`: CHK variable `.mjs` → `.ts`
   - `scripts/rolling-slope-selfcheck.sh`: CHK variable `.mjs` → `.ts`
   - `scripts/outward-vt-selfcheck.sh`: CHK variable `.mjs` → `.ts`
   - `scripts/git-lens-selfcheck.sh`: all direct `node scripts/git-lens-*.mjs` calls → `.ts`
   - Comment references in selfcheck files (fix-belongs-in lines) → `.ts`

   **Test file static imports** (in `experiments/quay-perpetual-stream/scripts/*.test.mjs` if they exist, and in `packages/quay/test/` if any):
   - `adr-gate.test.mjs` (if it has a literal path to `loadbearing-test-gate.mjs`) → `.ts`
   - Any `from "../scripts/foo.mjs"` imports in test files for the 9 migrated scripts → `.ts`

   **Doc files**:
   - `inherited-core.md`: 3 `.mjs` references — `vmeta-lag-check.mjs`, `audit-independence-check.mjs` (two occurrences); leave `it0-dod-check.mjs` untouched
   - `OUTER-LOOP.md`: 4 `.mjs` references — `audit-independence-check.mjs`, `vmeta-lag-check.mjs`, `rolling-slope-check.mjs`, `governance-product-ratio-check.mjs`

5. **Run `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json`** — must exit 0.

6. **Capture post-migration golden outputs**: same 7 selfcheck commands as step 1, save to `/tmp/selfcheck-after-<name>.txt`.

7. **Diff each pair**: `diff /tmp/selfcheck-before-<name>.txt /tmp/selfcheck-after-<name>.txt` — must produce empty output for all 7. Paste the diff results as evidence.

8. **Confirm `it0-dod-check.mjs` untouched**: `git diff experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` must be empty; grep for `audit-independence-check.mjs` in it0-dod-check.mjs must still find it (unchanged).

9. **Run gate test suite**: `node --test packages/quay/test/gate.test.mjs`

10. **Update task `exp5-M-TS-MIGRATION-P4`**: check AC/DoD boxes applicable to Batch 1 (partial); add progress note.

11. **Run DoD meta-enforcer**: `node experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs`

12. **Write adversarial audit** to `milestones/M106/audits/iteration-0-acceptance-audit.md` with distinct audit session id.

13. **Commit**:
    ```sh
    git add experiments/quay-perpetual-stream/scripts/ experiments/quay-perpetual-stream/OUTER-LOOP.md experiments/quay-perpetual-stream/inherited-core.md packages/quay/test/ milestones/M106/ tasks/exp5-M-TS-MIGRATION-P4.md
    git commit -m "feat(P4-batch1): migrate 9 method-infra scripts .mjs→.ts (M106)"
    ```

14. Write ABSORB entry to `/tmp/m106-absorb-entry.md`.

## Acceptance Criteria Check

- [ ] All 9 scripts renamed `.mjs` → `.ts`; `npx tsc --noEmit -p scripts/tsconfig.json` exits 0
- [ ] Each selfcheck produces byte-identical output before/after (golden-diff pasted)
- [ ] `it0-dod-check.mjs` untouched
- [ ] All reference locations updated (shell wrappers, selfchecks, test imports, docs)
- [ ] Gate test suite passes
