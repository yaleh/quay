# Charter M114-ts-migration-overall-close — TS migration overall program close (ADR-012)

**Milestone id:** M114  
**Task:** `tasks/exp5-M-TS-MIGRATION.md` (program root, parent of P0–P4)  
**Surface:** methodology-class / closure  
**Type:** methodology-class / closure  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

All 5 phase children of the TS migration program are done or needs-human:
- **P0** (pre-M77): tsconfig + tsc gate + Node native type-stripping confirmed ✓
- **P1** (M77): provider-client.js → .ts ✓
- **P2** (M79): Provider ABI interfaces (abi.ts) ✓
- **P3** (M112, done): all per-package migrations (quay-native/M80, quay-github/M81, quay Core M82+M84+M85) ✓
- **P4** (M111, needs-human): method-infra scripts; AC1/AC2 verified; AC3 (archguard plugin-workspace verification) = needs-human (no archguard session at M111 dispatch)

**The program-level ACs** are:
1. P0 tooling: `tsconfig` + `tsc --noEmit` gate + Node native type-stripping — SATISFIED (P0/M77 evidence)
2. Behavior-preserving per phase: full suite green throughout — SATISFIED (each phase milestone confirmed this; M113 test suite still green)
3. Provider ABI as TS interfaces (P2) — SATISFIED (M79)
4. archguard L_G/L_D reading on migrated product — SATISFIED (M113: entities=121, relations=156, loadWorkspaceGates outDegree=3, startServer=7, no cycles, no god-packages)

**P4's `needs-human` AC3** (archguard PLUGIN workspace verification — did the archguard consumer workspace adopt the renamed `.ts` vendored scripts?) is scoped to P4 and does NOT block the program-level DoD. The program DoD asks:
> "archguard runs on the migrated product and yields an L_G/L_D reading recorded on the dashboard"

M113 provides exactly this. P4's AC3 is about the archguard workspace consuming the plugin's scripts — a separate, operational concern.

## Scope

1. **Verify current state:**
   ```
   # Test suite still green post-M113
   cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')
   ```

2. **Tick all parent AC/DoD boxes** in `tasks/exp5-M-TS-MIGRATION.md`, citing evidence:
   - AC1 `[x]`: P0 tsconfig + tsc gate + Node native type-stripping (M77/P1 confirmed)
   - AC2 `[x]`: behavior-preserving per phase — all phase milestones confirmed green suites
   - AC3 `[x]`: Provider ABI typed (M79/P2)
   - AC4 `[x]`: archguard L_G/L_D reading on migrated product (M113: entities=121/relations=156, recorded in dashboard)
   - DoD#1 `[x]`: quay product code runs on TypeScript, all tests green
   - DoD#2 `[x]`: archguard produced L_G/L_D reading (M113 ABSORB + M113 task Resolution section)
   - DoD#3 `[x]`: types add L_C hardening; Go not adopted

3. **Set parent task status to `done`.**

4. **Add evidence references** in a new `## Resolution` section of the task body:
   - P3 closure: M112 (milestone_counter=112)
   - P4 closure: M111 (milestone_counter=111, needs-human AC3)
   - Archguard evidence: M113 ABSORB + `tasks/exp5-M-ARCH-AUDIT-POST-FULL-TS.md` Resolution section
   - M113 archguard metrics: entities=121, relations=156, no cycles, no god-packages

5. **Run DoD meta-enforcer:**
   ```
   bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-TS-MIGRATION \
     experiments/quay-perpetual-stream/charters/M114-ts-migration-overall-close.md \
     /tmp/m114-absorb-check.md
   ```

6. **Create `milestones/M114/` + audit file.**

7. **Commit.**

**Not in scope:**
- Resolving P4's AC3 needs-human (requires live archguard session)
- Fixing the pre-existing TS2589 type error in `quay-github/src/mcp-server.ts` (pre-existing; separate task if warranted)
- Any behavior change to the packages

## Class routing

**Methodology-class / closure** — FILE-ONLY (only `tasks/exp5-M-TS-MIGRATION.md` modified + milestone evidence files).

## Acceptance Criteria

- [ ] All 4 program-level AC boxes ticked `[x]` with evidence citations.
- [ ] All 3 DoD boxes ticked `[x]`.
- [ ] Status set to `done`.
- [ ] Resolution section added documenting AC4 evidence (M113 archguard data).

## Definition of Done

- [ ] Parent task `exp5-M-TS-MIGRATION.md` — status: done, all AC/DoD boxes [x].
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

`22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1`
