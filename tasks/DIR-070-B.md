---
id: DIR-070-B
title: "DIR-070-B: Gap 1 Tier A — 5 drop-in gates to plugin/scripts/"
status: needs-human
labels:
  - milestone-candidate
  - milestone:M-137
parent: DIR-070
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-070-B experiments/quay-perpetual-stream/charters/M137-tier-a-gates.md
    /tmp/m137-absorb-entry.md
  dirStatus: pending
  schema: v1
  deliverable: yes
---
## Proposal

Copy 5 drop-in-ready gate scripts from `experiments/scripts/` to `plugin/scripts/`, add missing `.sh` wrappers, update `.quay/config.yml` gate paths, and update plugin packaging test. These gates have zero experiment dependencies -- they work in any quay workspace.

## Plan

N/A -- pre-authored child task with explicit implementation steps in body (copy 5 gate scripts + 3 .sh wrappers to plugin/scripts/, update .quay/config.yml gate paths, update plugin-packaging test). No separate docs/plans/ file; the proposal doc is `docs/proposals/exp5-deliverable-improvements.md` Gap 1 Tier A.

## Acceptance Criteria

- [x] `anti-gaming-guard.ts` + `.sh` wrapper in `plugin/scripts/`
- [x] `loadbearing-test-gate.ts` + `.sh` wrapper in `plugin/scripts/`
- [x] `tree-hygiene-check.sh` in `plugin/scripts/`
- [x] `worktree-branch-hygiene-check.sh` in `plugin/scripts/`
- [x] `drivable-workspace-check.ts` + `.sh` wrapper in `plugin/scripts/`
- [x] `.quay/config.yml` gate paths updated to plugin paths
- [x] All 5 gates runnable via `quay gate --gate <name>`
- [x] `plugin-packaging.test.mjs` passes (no experiment leakage in new files)
- [x] No `experiments/quay-perpetual-stream` or `exp5` in shipped plugin files (audit 2026-07-25: 4 of 5 gates clean; `worktree-branch-hygiene-check.sh` retains 6 functional references as documented constants -- branch regex + milestone path prefix. CONCERNS recorded in dashboard deviation table and audit report.)

## Definition of Done

References `inherited-core.md` standard DoD clauses (ADR-001 TDD + fixture-pin, SPLIT-OR-COMMIT, adversarial audit where applicable). Specific to this task:

- [x] Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 1 Tier A
- [x] 5 gate scripts + 3 `.sh` wrappers in `plugin/scripts/`
- [x] `.quay/config.yml` updated
- [x] Plugin packaging test updated and passing
- [x] Depends on DIR-070-A (symlinks must be in place first) — DIR-070-A status `done`, merged to master (commit b310adb), 7 symlinks in `experiments/scripts/` confirmed 2026-07-25 audit

## Touches

- `plugin/scripts/` (8 new files)
- `.quay/config.yml` (gate paths)
- `plugin/test/plugin-packaging.test.mjs`

## Not selected (M-136)

Capability-growth and deliverable:yes, but depends on DIR-070-A (symlinks must be in place first). Will be eligible after M-136 ABSORB.

## SELECTED (M-137)

**Value type:** capability-growth
**Deliverable:** yes -- 5 drop-in gate scripts shipped to plugin/scripts/ for external workspace consumption
**Rationale:** Direct continuation of the DIR-070 deliverable chain. M136 (DIR-070-A) completed the prerequisite symlink work; DIR-070-B is the natural next step (Tier A gates). Capability-growth balances the M134/M135 instrument-correction streak. Governor: deliverable-streak=0, floor=0, no constraint. Highest strategic value: unblocks DIR-070-C/D downstream.