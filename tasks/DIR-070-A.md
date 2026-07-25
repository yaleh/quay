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
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-070-A
    experiments/quay-perpetual-stream/charters/M136-dual-copy-resolution.md
    /tmp/m136-absorb-entry.md
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

- [x] `sync-vendor.sh --check` exits non-zero when experiment->plugin drift is detected — [audit: tested by replacing symlink with real file + diff, --check exits 1 with DRIFT report]
- [x] `sync-vendor.sh --check` exits 0 when all copies are identical (or expected-different) — [audit: after sync-vendor.sh run, --check exits 0 with CLEAN report]
- [x] 7 symlinks created: `experiments/scripts/<name>` -> `../../../plugin/scripts/<name>` — [audit: all 7 are symbolic links resolved to ../../../plugin/scripts/<name> via `file` command]
- [x] `sync-vendor.sh` skips symlinks (does not overwrite them) — [audit: code review L159 `test -L` guard; normal run prints "skipping symlink: ..." x7]
- [x] `plugin/test/plugin-packaging.test.mjs` passes with dynamic scanning — [audit: M136 dynamic scanning test PASSES, 18/19 overall (1 pre-existing M143 workflow sync failure, unrelated)]
- [x] Existing experiment selfcheck fixtures continue to work (symlink transparent) — [audit: probe-spec-wiring.test.mjs 8/8 pass; task-schema-selfcheck.sh 14/14 pass; dod-fixture-selfcheck.sh 17/17 pass]
- [x] Group 2 files (task-schema) remain real files -- not symlinked — [audit: all 3 task-schema files are regular files, not symlinks]

## Definition of Done

References `inherited-core.md` standard DoD clauses (ADR-001 TDD + fixture-pin, SPLIT-OR-COMMIT, adversarial audit where applicable). Specific to this task:

- [x] Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 4 — [audit: charter, task body, and commit message all reference Gap 4]
- [x] `sync-vendor.sh --check` mode implemented and tested — [audit: --check flag parsing, cmp_or_report(), DRIFT tracking, exit-code logic verified in sync-vendor.sh L39-74]
- [x] Plugin packaging test updated to dynamic scanning — [audit: test at plugin-packaging.test.mjs L140-170 runs sync-vendor.sh --check] 
- [x] 7 symlinks created and committed — [audit: commit ad2798e on worktree branch worktree-wf_f3871bbc-80a-6; all 7 in git show as symlink content]
- [x] `sync-vendor.sh test -L` guard in place — [audit: L159 if [ -L "$src_file" ]; then echo "skipping symlink: ${s}.ts"; continue; fi]
- [x] All existing tests green (plugin packaging, probe-spec-wiring, experiment selfchecks) — [audit: plugin-packaging 18/19 (1 pre-existing M143 failure); probe-spec-wiring 8/8; task-schema-selfcheck 14/14; dod-fixture-selfcheck 17/17]

## Touches

- `plugin/scripts/sync-vendor.sh`
- `plugin/test/plugin-packaging.test.mjs`
- `experiments/quay-perpetual-stream/scripts/` (7 files -> symlinks)

## SELECTED (M-136)

**Value type:** capability-growth
**Deliverable:** yes -- sync-vendor --check mode ships in plugin/; symlinks resolve the dual-copy structural problem
**Rationale:** Closes Gap 4 (dual-copy resolution), the first and enabling step in the DIR-070 deliverable chain. M134/M135 were instrument-correction milestones; capability-growth balances the ledger. Governor: D_seats=1, N_seats=3 (streak=2, floor=0.333). Highest value-type priority in the shortlist. Unblocks DIR-070-B/C/D.