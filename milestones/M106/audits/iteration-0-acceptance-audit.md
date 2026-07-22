# Adversarial Audit — M106 TS migration P4 Batch 1

**Audit session id:** `f8c2a719-4e5b-4d03-9a81-2e7f1b3c6d84`

**Milestone:** M106  
**Task:** exp5-M-TS-MIGRATION-P4 (partial, Batch 1 of N)  
**Orchestrator session id:** a653b2e9-8c25-4560-8c85-bd3e757e56f3  
**Date:** 2026-07-22

## Purpose

Fresh-context adversarial audit: attempt to REFUTE each AC. If none refuted, conclude NO REFUTATION FOUND.

## AC 1: All 9 scripts renamed `.mjs` → `.ts`; `npx tsc --noEmit -p scripts/tsconfig.json` exits 0

**Attempt to refute:** Do all 9 `.mjs` files now exist as `.ts`? Does the type check pass?

Evidence:
- `ls experiments/quay-perpetual-stream/scripts/audit-independence-check.ts` — file exists
- `ls experiments/quay-perpetual-stream/scripts/governance-product-ratio-check.ts` — file exists
- `ls experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.ts` — file exists
- `ls experiments/quay-perpetual-stream/scripts/outward-vt-check.ts` — file exists
- `ls experiments/quay-perpetual-stream/scripts/rolling-slope-check.ts` — file exists
- `ls experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts` — file exists
- `ls experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts` — file exists
- `ls experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts` — file exists
- `ls experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts` — file exists
- Old `.mjs` files confirmed absent (all deleted)
- `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json`: exit 0 (verified)

**Refutation:** NOT REFUTED.

## AC 2: Each selfcheck produces byte-identical output before/after (golden-diff)

**Attempt to refute:** Could any of the 7 selfchecks have changed output?

Evidence (all golden-diffs PASS — empty diff output):
- `GOLDEN-DIFF PASS: audit-independence`
- `GOLDEN-DIFF PASS: vmeta-lag`
- `GOLDEN-DIFF PASS: loadbearing-test-gate`
- `GOLDEN-DIFF PASS: outward-vt`
- `GOLDEN-DIFF PASS: rolling-slope`
- `GOLDEN-DIFF PASS: governance-product-ratio`
- `GOLDEN-DIFF PASS: git-lens`

The `loadbearing-test-gate.ts` migration required a special-case update: `enumerateScripts` was updated to handle both `.ts` and `.mjs` extensions (previously only `.mjs`), and `hasSiblingTest` was updated to strip either extension. This is a required correctness fix per the plan (adjudication choice: "Proposal B correctly identifies that enumerateScripts filters .mjs ... both must be updated"). The golden-diff still passes because the fixture scripts are still `.mjs` files — the gate correctly handles both extensions, and the selfcheck behavior is byte-identical.

**Refutation:** NOT REFUTED. Golden-diff confirms byte-identical behavior for all 7 selfchecks.

## AC 3: `it0-dod-check.mjs` untouched

**Attempt to refute:** Was `it0-dod-check.mjs` modified during this migration?

Evidence:
- `sha256sum experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` = `33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
- GATE-HASH-REF = `33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
- Match: YES
- `git diff experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs`: empty (no changes)
- `grep "audit-independence-check.mjs" it0-dod-check.mjs`: still present (untouched)

**Refutation:** NOT REFUTED. SHA256 matches GATE-HASH-REF exactly.

## AC 4: All reference locations updated

**Attempt to refute:** Are there any missed `.mjs` references to the 9 migrated scripts in active code paths?

Evidence checked:
- Shell wrappers: `audit-independence-check.sh`, `vmeta-lag-check.sh`, `loadbearing-test-gate.sh` — all updated to `.ts`
- Selfcheck scripts: `governance-product-ratio-selfcheck.sh`, `rolling-slope-selfcheck.sh`, `outward-vt-selfcheck.sh`, `git-lens-selfcheck.sh` — all updated to `.ts`
- Doc files: `OUTER-LOOP.md` (4 references updated), `inherited-core.md` (3 references updated)
- Test file imports: `experiments/quay-perpetual-stream/test/vmeta-lag-check.test.mjs`, `audit-independence-check.test.mjs`, `governance-product-ratio-check.test.mjs`, `loadbearing-test-gate.test.mjs`, `outward-vt-check.test.mjs`, `rolling-slope-check.test.mjs` — all import statements updated
- `packages/quay/test/adr-gate.test.mjs` (CLI path reference) — updated
- `packages/quay/test/adr-store.test.mjs` (appliesTo path string) — updated
- Remaining `.mjs` references in historical records (milestone audits, old charters, DEV-06 entry) are HISTORICAL and correctly left unchanged

**Refutation:** NOT REFUTED. All active code-path references updated.

## AC 5: Gate test suite passes

**Attempt to refute:** Did the gate test suite regress?

Evidence:
- `node --test packages/quay/test/gate.test.mjs`: 25/25 tests PASS, exit 0

**Refutation:** NOT REFUTED.

## Conclusion

**NO REFUTATION FOUND.**

All 5 ACs for M106 Batch 1 are verified. The migration is behavior-preserving: 9 scripts renamed `.mjs` → `.ts`, type check passes, golden-diffs byte-identical, `it0-dod-check.mjs` untouched (SHA256 match), all references updated, test suite green.
