# Charter M107-ts-migration-p4-batch2 — TS migration P4 Batch 2 (non-vendor remaining scripts)

**Milestone id:** M107  
**Task:** `tasks/exp5-M-TS-MIGRATION-P4.md` (milestone-candidate, crystallization)  
**Surface:** `experiments/quay-perpetual-stream/scripts/` — Batch 2: remaining non-vendor scripts  
**Type:** development-class / crystallization  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

M106 (Batch 1) migrated 9 selfcheck-paired scripts to TypeScript. This milestone (Batch 2) migrates the 7 remaining method-infra scripts that have NO plugin vendor copies, clearing the non-vendor scope of P4. After this, only 9 vendor-copy scripts and `it0-dod-check.mjs` remain.

**Scripts in scope (Batch 2):**

| Script | Pin |
|---|---|
| `it0-enforcement-with-design-check.mjs` | `it0-enforcement-with-design-check.test.mjs` (run via `node --test`) |
| `it0-split-or-commit-check.mjs` | `it0-split-or-commit-check.test.mjs` (run via `node --test`) |
| `golden-replay-dir044.mjs` | full test suite + invocation smoke-test |
| `it0-backlog-projection-check.mjs` | full test suite as regression guard |
| `it0-backlog-regen.mjs` | full test suite as regression guard |
| `it0-task-bulk-write.mjs` | full test suite as regression guard |
| `regenerate-backlog-view.mjs` | full test suite as regression guard |

**Out of scope:**
- `it0-dod-check.mjs` (GATE-HASH-REF pin — separate milestone)
- Vendor-copy scripts: `anti-drift-touches-check.mjs`, `concurrent-batch-scheduler.mjs`, `routine-file-gate.mjs`, `routine-scheduler.mjs`, `serial-fanin-absorb.mjs`, `task-schema.mjs`, `touches-orthogonality-check.mjs`, `read-probe-spec.mjs`, `task-schema-check.mjs` — require plugin.json bump + vendor sync (separate milestone)
- All M106 scripts (already migrated)

## Scope

**In scope:**

1. **Migrate 7 scripts** from `.mjs` to `.ts` (rename + add type annotations to exported signatures)

2. **Pin verification for test-pinned scripts:**
   - Run `node --test experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.test.mjs` before and after migration — output must be byte-identical
   - Run `node --test experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.test.mjs` before and after — output must be byte-identical

3. **Update all reference locations** for the 7 scripts (grep OUTER-LOOP.md, inherited-core.md, gates.yml, shell scripts)

4. **Run existing test suite** as regression guard: `node --test packages/quay/test/gate.test.mjs` + broader suite

5. **Verify `it0-dod-check.mjs` untouched** — sha256sum must equal GATE-HASH-REF

**Out of scope:** Changing script logic, migrating vendor-copy scripts, migrating it0-dod-check.mjs, adding new scripts.

## Class routing

**Development-class** — code change in `experiments/quay-perpetual-stream/scripts/`. Requires quay-task-to-plan (N=2 proposals → adjudication → plan → executor). Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] All 7 scripts renamed `.mjs` → `.ts`; `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json` exits 0
- [ ] Test-pinned scripts: byte-identical `node --test` output before/after (evidence pasted)
- [ ] All references to these 7 scripts updated from `.mjs` to `.ts` where found
- [ ] Gate test suite passes
- [ ] `it0-dod-check.mjs` untouched (sha256sum = GATE-HASH-REF)

## Definition of Done

- [ ] 7 scripts migrated; `tsc --noEmit` passes
- [ ] Byte-identical test output for pinned scripts (pasted)
- [ ] Full test suite passes; no behavior regression
- [ ] Fresh-context adversarial audit: NO REFUTATION FOUND
- [ ] it0 DoD meta-enforcer: all 12 clauses PASS

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
