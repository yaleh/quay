# Charter M106-ts-migration-p4-batch1 — TS migration P4 Batch 1 (non-vendor method-infra scripts)

**Milestone id:** M106  
**Task:** `tasks/exp5-M-TS-MIGRATION-P4.md` (milestone-candidate, crystallization)  
**Surface:** `experiments/quay-perpetual-stream/scripts/` — Batch 1: selfcheck-paired, no plugin-vendor copies  
**Type:** development-class / crystallization  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

P3-A/B/C are done (all `packages/**` product code is TypeScript). P4 migrates the method-infra scripts in `experiments/quay-perpetual-stream/scripts/` from `.mjs` to `.ts`. The migration is behavior-preserving-by-construction (language port only; Node 25 native type-stripping runs `.ts` directly with no build step). Golden-diff invariant: each script's `-selfcheck.sh` fixture must produce byte-identical verdicts before and after migration.

**Split-or-commit at SELECT:** P4's full scope (28 scripts) is over-ceiling. This milestone (Batch 1) commits to **9 scripts that (a) have no plugin-vendor copies and (b) are paired with a `-selfcheck.sh` fixture**. The GATE-HASH-REF-pinned `it0-dod-check.mjs` is permanently excluded from this batch (its migration requires a GATE-HASH-REF rotation across inherited-core.md and charter machinery — a separate milestone boundary).

**Scripts in scope (Batch 1):**

| Script | Selfcheck fixture |
|---|---|
| `audit-independence-check.mjs` | `audit-independence-selfcheck.sh` |
| `governance-product-ratio-check.mjs` | `governance-product-ratio-selfcheck.sh` |
| `loadbearing-test-gate.mjs` | `loadbearing-test-gate-selfcheck.sh` |
| `outward-vt-check.mjs` | `outward-vt-selfcheck.sh` |
| `rolling-slope-check.mjs` | `rolling-slope-selfcheck.sh` |
| `vmeta-lag-check.mjs` | `vmeta-lag-selfcheck.sh` |
| `git-lens-l-d-code-doc-ratio.mjs` | `git-lens-selfcheck.sh` (covers all 3 git-lens) |
| `git-lens-l-g-structural-drift.mjs` | (same) |
| `git-lens-l-s-behavior-variance.mjs` | (same) |

**Out of scope for this batch:**
- `it0-dod-check.mjs` (GATE-HASH-REF pin — separate milestone)
- Scripts with plugin vendor copies: `routine-file-gate.mjs`, `routine-scheduler.mjs`, `anti-drift-touches-check.mjs`, `concurrent-batch-scheduler.mjs`, `serial-fanin-absorb.mjs`, `task-schema.mjs`, `touches-orthogonality-check.mjs`, `read-probe-spec.mjs` (requires plugin plugin.json bump + sync)
- Scripts without selfcheck fixtures: `golden-replay-dir044.mjs`, `it0-backlog-regen.mjs`, `it0-task-bulk-write.mjs`, etc.

## Scope

**In scope:**

1. **Migrate each of the 9 scripts** from `.mjs` to `.ts`:
   - Rename file (`.mjs` → `.ts`)
   - Add TypeScript type annotations where types are non-obvious
   - Update any `#!/usr/bin/env node` shebangs if present
   - Run `npx tsc --noEmit` across the repo — must pass
   - Run each script's selfcheck: `bash experiments/quay-perpetual-stream/scripts/<name>-selfcheck.sh` — must produce byte-identical output to pre-migration (the golden-diff)

2. **Update any import references** that call these scripts by name (e.g. `node experiments/.../script.mjs` → `node experiments/.../script.ts`). Check:
   - `experiments/quay-perpetual-stream/OUTER-LOOP.md`
   - `experiments/quay-perpetual-stream/inherited-core.md`
   - `experiments/quay-perpetual-stream/.quay/gates.yml`
   - Shell scripts that invoke these scripts

3. **Verify golden-diff**: run each `-selfcheck.sh` before migration (record output), then after migration (compare). Must be byte-identical.

4. **Run existing test suite** to confirm no regressions: `node --test packages/quay/test/gate.test.mjs` (representative).

**Out of scope:** Changing any script's verdict logic, migrating it0-dod-check.mjs, migrating plugin-vendor-copy scripts, any new script authoring.

## Class routing

**Development-class** — code change in `experiments/quay-perpetual-stream/scripts/`. Requires quay-task-to-plan (N=2 proposals → adjudication → plan → executor). Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] All 9 scripts renamed `.mjs` → `.ts`; `npx tsc --noEmit` exits 0
- [ ] Each script's selfcheck fixture produces byte-identical output before/after migration (golden-diff)
- [ ] All references to these 9 scripts updated from `.mjs` to `.ts` where found
- [ ] Gate test suite passes (`node --test packages/quay/test/gate.test.mjs`)
- [ ] `it0-dod-check.mjs` untouched (still `.mjs`, GATE-HASH-REF unchanged)

## Definition of Done

- [ ] All 9 scripts migrated to `.ts`; `tsc --noEmit` passes
- [ ] Byte-identical golden-diff on each selfcheck fixture (pasted evidence)
- [ ] Full test suite passes; no behavior regression
- [ ] Fresh-context adversarial audit: NO REFUTATION FOUND
- [ ] it0 DoD meta-enforcer: all 12 clauses PASS

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
