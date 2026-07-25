---
id: DIR-070-B
title: "DIR-070-B: Gap 1 Tier A — 5 drop-in gates to plugin/scripts/"
status: todo
labels:
  - milestone-candidate
parent: DIR-070
children: []
extra:
  dirStatus: pending
  schema: v1
  deliverable: yes
---
## Proposal

Copy 5 drop-in-ready gate scripts from `experiments/scripts/` to `plugin/scripts/`, add missing `.sh` wrappers, update `.quay/config.yml` gate paths, and update plugin packaging test. These gates have zero experiment dependencies -- they work in any quay workspace.

## Plan

### Copy gates + create wrappers
1. Copy to `plugin/scripts/`: `anti-gaming-guard.ts`, `loadbearing-test-gate.ts`, `tree-hygiene-check.sh`, `worktree-branch-hygiene-check.sh`, `drivable-workspace-check.ts`
2. Add `.sh` wrappers for the `.ts` files following the existing pattern: arg-count check -> `command -v node` -> `node "$(dirname "$0")/<name>.ts" "$@"` -> `exit $?`
   - `anti-gaming-guard.sh` (new -- no wrapper exists in experiments/)
   - `loadbearing-test-gate.sh` (copy from experiments/ -- already exists)
   - `drivable-workspace-check.sh` (new -- no wrapper exists in experiments/)

### Update config
3. Update `.quay/config.yml` gate paths from `./experiments/quay-perpetual-stream/scripts/` to `./plugin/scripts/` for the moved gates. Add new gate entries for the ones not yet registered in the config.

### Update tests
4. Update `plugin/test/plugin-packaging.test.mjs` to cover the new files (leak check -- must NOT contain `experiments/quay-perpetual-stream` or `exp5`)

## Acceptance Criteria

- [ ] `anti-gaming-guard.ts` + `.sh` wrapper in `plugin/scripts/`
- [ ] `loadbearing-test-gate.ts` + `.sh` wrapper in `plugin/scripts/`
- [ ] `tree-hygiene-check.sh` in `plugin/scripts/`
- [ ] `worktree-branch-hygiene-check.sh` in `plugin/scripts/`
- [ ] `drivable-workspace-check.ts` + `.sh` wrapper in `plugin/scripts/`
- [ ] `.quay/config.yml` gate paths updated to plugin paths
- [ ] All 5 gates runnable via `quay gate --gate <name>`
- [ ] `plugin-packaging.test.mjs` passes (no experiment leakage in new files)
- [ ] No `experiments/quay-perpetual-stream` or `exp5` in shipped plugin files

## Definition of Done

- [ ] Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 1 Tier A
- [ ] 5 gate scripts + 3 `.sh` wrappers in `plugin/scripts/`
- [ ] `.quay/config.yml` updated
- [ ] Plugin packaging test updated and passing
- [ ] Depends on DIR-070-A (symlinks must be in place first)

## Touches

- `plugin/scripts/` (8 new files)
- `.quay/config.yml` (gate paths)
- `plugin/test/plugin-packaging.test.mjs`

## Not selected (M-136)

Capability-growth and deliverable:yes, but depends on DIR-070-A (symlinks must be in place first). Will be eligible after M-136 ABSORB.