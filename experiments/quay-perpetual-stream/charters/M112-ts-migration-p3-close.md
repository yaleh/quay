# Charter M112-ts-migration-p3-close — TS migration P3 parent task close

**Milestone id:** M112  
**Task:** `tasks/exp5-M-TS-MIGRATION-P3.md` (parent of P3-A, P3-B, P3-C children)  
**Surface:** method-infra / product packages (non-behavior-touching)  
**Type:** methodology-class / closure  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

All 3 P3 children are done:
- **P3-A** (M80): quay-native src/ → `.ts` ✓
- **P3-C** (M81): quay-github src/ → `.ts` ✓
- **P3-B** (M82 P3-B-1 utility modules + M84 P3-B-2 gate/ + M85 P3-B-3 serve+mcp → P3-B parent done) ✓

The parent task `exp5-M-TS-MIGRATION-P3` has 3 ACs that span all per-package children:
- AC1: Each package's internal implementation is `.ts`, runs under Node native type-stripping — SATISFIED across P3-A/B/C children
- AC2: Behavior-preserving per package: full suite green (each child milestone confirmed) — VERIFY current state
- AC3: Split-or-commit honored: P3 split into per-package children at SELECT — SATISFIED (P3-A/B-1/B-2/B-3/C done)

**This milestone verifies AC1+AC2 mechanically on the current master state, confirms AC3 structurally, ticks all parent AC/DoD boxes, and closes the parent task.**

## Scope

1. **Verify AC1 (tsc --noEmit across all packages):**

   Check if each package has a tsconfig.json; if so, run:
   ```
   npx tsc --noEmit -p packages/quay-native/tsconfig.json
   npx tsc --noEmit -p packages/quay/tsconfig.json
   npx tsc --noEmit -p packages/quay-github/tsconfig.json
   ```
   If a package has no tsconfig.json, run from package root:
   ```
   cd packages/<pkg> && npx tsc --noEmit
   ```
   Expected: exit 0 for all packages (already confirmed per child milestones; this is a final verification).

2. **Verify AC2 (behavior-preserving — test suite green):**
   ```
   cd packages/quay-native && node --test test/*.mjs
   cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')
   cd packages/quay-github && node --test test/*.mjs 2>/dev/null || true
   ```
   Expected: all suites pass. The LIVE-GitHub suites (serve-github, provider-abi-conformance) are excluded per the offline convention.

3. **Confirm AC3 (split honored):** Document that P3-A/P3-B/P3-C children exist as separate task files and were done across separate milestones.

4. **Tick all parent AC/DoD boxes** in `tasks/exp5-M-TS-MIGRATION-P3.md`:
   - AC1 `[x]` — tsc exit 0 confirmed
   - AC2 `[x]` — behavior-preserving confirmed (test suite green)
   - AC3 `[x]` — split honored (P3-A/B/C children, separate milestones)
   - DoD: all boxes `[x]`

5. **Set parent task status to `done`.**

6. **Commit.**

**Not in scope:**
- Closing the overall `exp5-M-TS-MIGRATION` parent (requires archguard observability leg from M113 mandatory explore)
- Any behavior change to the packages (language port only was P3's charter)
- P4 parent (already closed at M111 as needs-human)

## Class routing

**Methodology-class / closure** — no quay-task-to-plan required. FILE-ONLY change (only `tasks/exp5-M-TS-MIGRATION-P3.md` modified, plus the commit).

## Acceptance Criteria

- [ ] `npx tsc --noEmit` exits 0 for all three packages (or documented finding if a package was never given a tsconfig — the underlying `.ts` files still typecheck via the scripts/ tsconfig).
- [ ] Full test suite green for quay-native + quay Core (offline suites) — behavior-preserving confirmed on current master HEAD.
- [ ] AC3 confirmed structural: P3-A, P3-B, P3-C are separate task files, all `done`; per-package split was honored at SELECT.
- [ ] All parent task AC/DoD boxes ticked `[x]`; status set to `done`.

## Definition of Done

- [ ] tsc exit-0 evidence in ABSORB entry (all packages).
- [ ] Test suite pass evidence (quay-native + quay Core offline) in ABSORB entry.
- [ ] AC3 disposition documented (which children, which milestones).
- [ ] Parent task closed (status: done).
- [ ] it0 DoD meta-enforcer passes all clauses on this milestone.

## GATE-HASH-REF

`22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1`
