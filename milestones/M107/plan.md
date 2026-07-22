# M107 Plan — TS migration P4 Batch 2 (non-vendor remaining scripts)

**Charter:** `experiments/quay-perpetual-stream/charters/M107-ts-migration-p4-batch2.md`  
**Adjudication date:** 2026-07-22  
**Type:** development-class / crystallization

## Adjudication

Both proposals agree on mechanics. Key adjudication choices:

- **`.quay/gates.yml` critical finding** (Proposal B): gates.yml has live `.mjs` references to `it0-split-or-commit-check` and `it0-enforcement-with-design-check` (confirmed by grep). These MUST be updated or the gates break. Use Proposal B's full reference list.
- **`golden-replay-dir044.ts` vendor imports**: The 4 vendor-copy imports (`touches-orthogonality-check.mjs`, `concurrent-batch-scheduler.mjs`, `serial-fanin-absorb.mjs`, `anti-drift-touches-check.mjs`) stay `.mjs` in the migrated `.ts` file — those scripts are not migrated in this batch.
- **`regenerate-backlog-view.ts` imports `task-schema.mjs`**: stays `.mjs` (vendor copy, out of scope).
- **Typing strategy**: match M106 precedent — type annotations on exported function signatures and config object shapes only; `strict: false` (root tsconfig).
- **GATE-HASH-REF post-check**: re-verify sha256sum after all changes as the final sentinel.

## Steps

1. **Capture baselines for test-pinned scripts** (BEFORE any changes):
   ```sh
   node --test experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.test.mjs > /tmp/baseline-enforcement.txt 2>&1
   node --test experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.test.mjs > /tmp/baseline-split.txt 2>&1
   ```

2. **Verify GATE-HASH-REF pre-flight**:
   ```sh
   sha256sum experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs
   # must equal: 33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb
   ```

3. **Migrate 7 scripts** (rename `.mjs` → `.ts`, add type annotations):
   - `it0-task-bulk-write.mjs` → `.ts`
   - `it0-backlog-regen.mjs` → `.ts`
   - `it0-backlog-projection-check.mjs` → `.ts`
   - `regenerate-backlog-view.mjs` → `.ts` (its import of `"./task-schema.mjs"` stays `.mjs`)
   - `it0-split-or-commit-check.mjs` → `.ts` (define `TaskFrontmatter` interface)
   - `it0-enforcement-with-design-check.mjs` → `.ts`
   - `golden-replay-dir044.mjs` → `.ts` (4 vendor imports stay `.mjs`)

4. **Update import specifiers in test/pin files**:
   - `it0-enforcement-with-design-check.test.mjs`: change import from `.mjs` → `.ts`
   - `it0-split-or-commit-check.test.mjs`: change import from `.mjs` → `.ts`

5. **Update all live reference locations**:
   - `.quay/gates.yml` lines 107, 113: command strings `.mjs` → `.ts`
   - `OUTER-LOOP.md` lines ~14, ~141, ~524: the 3 `.mjs` references
   - `experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.sh`: `it0-backlog-projection-check.mjs` → `.ts`

6. **Run TypeScript typecheck**:
   ```sh
   npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json
   ```
   Must exit 0. Fix any type errors.

7. **Pin verification for test-pinned scripts**:
   ```sh
   node --test experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.test.mjs > /tmp/after-enforcement.txt 2>&1
   diff /tmp/baseline-enforcement.txt /tmp/after-enforcement.txt  # must be empty
   node --test experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.test.mjs > /tmp/after-split.txt 2>&1
   diff /tmp/baseline-split.txt /tmp/after-split.txt  # must be empty
   ```
   Paste before/after outputs as DoD evidence.

8. **Smoke-test golden-replay**:
   ```sh
   node experiments/quay-perpetual-stream/scripts/golden-replay-dir044.ts
   ```
   Must exit 0.

9. **Full test suite regression guard**:
   ```sh
   node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')
   ```

10. **GATE-HASH-REF post-check** (final sentinel):
    ```sh
    sha256sum experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs
    # must still equal: 33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb
    ```
    If different: STOP — `it0-dod-check.mjs` was accidentally touched.

11. **Update task `exp5-M-TS-MIGRATION-P4`**: add Batch 2 progress note (still partial; don't mark done).

12. **Run DoD meta-enforcer**: `node experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs`

13. **Write adversarial audit** to `milestones/M107/audits/iteration-0-acceptance-audit.md` with distinct audit session id.

14. **Commit**:
    ```sh
    git add experiments/quay-perpetual-stream/scripts/ \
      .quay/gates.yml \
      experiments/quay-perpetual-stream/OUTER-LOOP.md \
      milestones/M107/ \
      tasks/exp5-M-TS-MIGRATION-P4.md
    git commit -m "feat(P4-batch2): migrate 7 remaining non-vendor scripts .mjs→.ts (M107)"
    ```

15. Write ABSORB entry to `/tmp/m107-absorb-entry.md`.

## Acceptance Criteria Check

- [ ] 7 scripts renamed `.mjs` → `.ts`; `tsc --noEmit` exits 0
- [ ] Test-pinned scripts: byte-identical `node --test` output (diffs pasted)
- [ ] `.quay/gates.yml` updated (split-or-commit and enforcement-with-design gates)
- [ ] All other reference locations updated
- [ ] `it0-dod-check.mjs` sha256 = GATE-HASH-REF (post-check)
