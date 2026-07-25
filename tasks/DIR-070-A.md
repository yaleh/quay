---
id: DIR-070-A
title: "DIR-070-A: Gap 4 — dual-copy resolution (sync-vendor --check + symlinks)"
status: todo
labels:
  - milestone-candidate
  - milestone:M-136
parent: DIR-070
children: []
extra:
  dirStatus: pending
  schema: v1
  deliverable: yes
---
## Proposal

Resolve the dual-copy structural problem where 7 scripts exist identically in both `plugin/scripts/` and `experiments/quay-perpetual-stream/scripts/`. Two-phase approach: drift detection first, then symlink elimination.

## Plan

N/A -- pre-authored task with explicit implementation steps in body (Phase 1: drift detection via sync-vendor.sh --check + dynamic plugin-packaging test; Phase 2: 7 symlinks replacing identical copies). No separate docs/plans/ file; the proposal doc is `docs/proposals/exp5-deliverable-improvements.md` Gap 4.

### Phase 1: Drift detection
1. Add `--check` mode to `plugin/scripts/sync-vendor.sh`: verifies experiment->plugin copies are identical (or expected-different for task-schema files) BEFORE copying. Exit non-zero on drift.
2. Update `plugin/test/plugin-packaging.test.mjs` to dynamically scan all sync-vendor-managed files instead of hardcoded static lists.

### Phase 2: Symlink elimination
3. Replace the 7 identical-copy files in `experiments/scripts/` with symlinks pointing at `../../../plugin/scripts/<name>`:
   - anti-drift-touches-check.ts
   - concurrent-batch-scheduler.ts
   - read-probe-spec.ts
   - routine-file-gate.ts
   - routine-scheduler.ts
   - serial-fanin-absorb.ts
   - touches-orthogonality-check.ts
4. Update `sync-vendor.sh` to skip symlinks (`test -L` guard).
5. Keep group 2 (task-schema.ts, task-schema-check.ts, task-schema-check.sh) as real files with intentional attribution differences.

## Acceptance Criteria

- [ ] `sync-vendor.sh --check` exits non-zero when experiment->plugin drift is detected
- [ ] `sync-vendor.sh --check` exits 0 when all copies are identical (or expected-different)
- [ ] 7 symlinks created: `experiments/scripts/<name>` -> `../../../plugin/scripts/<name>`
- [ ] `sync-vendor.sh` skips symlinks (does not overwrite them)
- [ ] `plugin/test/plugin-packaging.test.mjs` passes with dynamic scanning
- [ ] Existing experiment selfcheck fixtures continue to work (symlink transparent)
- [ ] Group 2 files (task-schema) remain real files -- not symlinked

## Definition of Done

References `inherited-core.md` standard DoD clauses (ADR-001 TDD + fixture-pin, SPLIT-OR-COMMIT, adversarial audit where applicable). Specific to this task:

- [ ] Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 4
- [ ] `sync-vendor.sh --check` mode implemented and tested
- [ ] Plugin packaging test updated to dynamic scanning
- [ ] 7 symlinks created and committed
- [ ] `sync-vendor.sh test -L` guard in place
- [ ] All existing tests green (plugin packaging, probe-spec-wiring, experiment selfchecks)

## Touches

- `plugin/scripts/sync-vendor.sh`
- `plugin/test/plugin-packaging.test.mjs`
- `experiments/quay-perpetual-stream/scripts/` (7 files -> symlinks)

## SELECTED (M-136)

**Value type:** capability-growth
**Deliverable:** yes -- sync-vendor --check mode ships in plugin/; symlinks resolve the dual-copy structural problem
**Rationale:** Closes Gap 4 (dual-copy resolution), the first and enabling step in the DIR-070 deliverable chain. M134/M135 were instrument-correction milestones; capability-growth balances the ledger. Governor: D_seats=1, N_seats=3 (streak=2, floor=0.333). Highest value-type priority in the shortlist. Unblocks DIR-070-B/C/D.