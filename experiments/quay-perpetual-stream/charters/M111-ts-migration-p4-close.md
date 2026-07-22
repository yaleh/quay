# Charter M111-ts-migration-p4-close — TS migration P4 parent task close

**Milestone id:** M111  
**Task:** `tasks/exp5-M-TS-MIGRATION-P4.md` (parent of all Batch 1-4 children)  
**Surface:** method-infra (non-product-touching)  
**Type:** methodology-class / closure  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

All 4 P4 batches are done:
- M106 Batch 1: 9 non-vendor scripts → `.ts` ✓
- M107 Batch 2: 7 non-vendor remaining scripts → `.ts` ✓
- M109 Batch 3: 9 vendor-copy scripts + plugin v0.3.20 → `.ts` ✓
- M110 Batch 4: `it0-dod-check.mjs` → `.ts` + GATE-HASH-REF rotation ✓

The parent task `exp5-M-TS-MIGRATION-P4` has 3 ACs that span the full program scope:
- AC1: All load-bearing scripts `.ts`, `tsc --noEmit` passes, Node native type-stripping works — SATISFIED across batches
- AC2: DoD meta-enforcer still passes all clauses post-migration; `dod-fixture-selfcheck.sh` still pins it — VERIFY
- AC3: Vendored plugin copies re-synced; archguard workspace still runs scripts — archguard remote-drive leg (needs-human escape hatch if no session available)

**This milestone verifies AC1+AC2 mechanically and attempts AC3; ticks all parent AC/DoD boxes; closes the parent task.**

## Scope

1. **Verify AC1 (tsc):**
   ```
   npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json
   ```
   Expected: exit 0.

2. **Verify AC2 (dod-fixture-selfcheck.sh):**
   ```
   bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh
   ```
   Confirms `it0-dod-check.ts` still passes the pinned fixture suite.

3. **Attempt AC3 (archguard consumer verification):**
   - Check if an archguard tmux session is available: `tmux list-sessions 2>/dev/null | grep archguard`
   - If available: remote-drive it to test that the plugin scripts still run (ADR-016 3-step send-keys)
   - If NOT available: land `needs-human` for this leg per the existing escape hatch

4. **Tick all parent AC/DoD boxes** in `tasks/exp5-M-TS-MIGRATION-P4.md`:
   - AC1, AC2: check ✓
   - AC3: check ✓ if archguard verified, or mark `needs-human` if not available
   - DoD boxes: same

5. **Set parent task status to `done`** (or `needs-human` if AC3 lands that way)

6. **Commit.**

## Class routing

**Methodology-class / closure** — no quay-task-to-plan required. FILE-ONLY per AC3 scope (only task file changes).

## Acceptance Criteria

- [ ] `tsc --noEmit` exits 0 on all migrated scripts (AC1 confirmed).
- [ ] `dod-fixture-selfcheck.sh` exits 0 (AC2 confirmed — DoD meta-enforcer self-pinning holds post-rename).
- [ ] AC3 archguard leg: either verified (remote-drive confirms scripts run in archguard workspace) or explicitly `needs-human` (no session available — documented in ABSORB entry).
- [ ] All parent task AC/DoD boxes ticked; status set to `done` or `needs-human`.

## Definition of Done

- [ ] tsc PASS evidence in ABSORB entry.
- [ ] dod-fixture-selfcheck.sh PASS evidence in ABSORB entry.
- [ ] AC3 disposition documented (verified or needs-human).
- [ ] Parent task closed (status: done or needs-human).
- [ ] it0 DoD meta-enforcer passes all clauses on this milestone.

## GATE-HASH-REF

`22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1`
