---
id: DIR-070-C
title: "DIR-070-C: Gap 1 Tier B — 5 parameterized gates to plugin/scripts/"
status: todo
labels:
  - milestone-candidate
  - milestone:M139
parent: DIR-070
children: []
extra:
  dirStatus: pending
  schema: v1
  deliverable: yes
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-070-C
    experiments/quay-perpetual-stream/charters/M139-dir070c-tierb-gates.md
    /tmp/m139-absorb-entry.md
---
## Proposal

Parameterize 5 Tier B gate scripts (minor experiment coupling, fixable with CLI flags) and move to `plugin/scripts/`. Each gate already has pure logic -- the coupling is only in default paths or env var names.

## Plan

N/A — plan is fully detailed inline below (5 gates each with specific coupling analysis and fix). Reference: `docs/proposals/exp5-deliverable-improvements.md` Gap 1 Tier B.

### audit-independence-check.ts
- Coupling: `QUAY_ORCHESTRATOR_SESSION_ID` env var name
- Fix: add `--orchestrator-env <name>` CLI flag (default maintains current behavior)

### vmeta-lag-check.ts
- Coupling: already parameterized via `--counter` + ledger file CLI arg
- Fix: verify existing parameterization, add `--threshold <K>` (default 2)

### it0-split-or-commit-check.ts
- Coupling: hardcoded `tasks/` subdirectory assumption
- Fix: add `--tasks-dir <dir>` CLI flag (default `tasks/`)

### it0-enforcement-with-design-check.ts
- Coupling: already parameterized via `--root` CLI arg
- Fix: verify existing parameterization, no code changes needed

### it0-impl-row-check.sh
- Coupling: backlog file path
- Fix: make backlog file path a CLI argument instead of hardcoded

### Move to plugin/
For each gate: copy the parameterized `.ts` file + `.sh` wrapper to `plugin/scripts/`, update `.quay/config.yml` gate paths, update `plugin-packaging.test.mjs`.

## Acceptance Criteria

- [ ] All 5 gates accept parameterized CLI flags for their experiment-specific defaults
- [ ] Default values maintain backward compatibility with current experiment
- [ ] All 5 gates + `.sh` wrappers in `plugin/scripts/`
- [ ] `.quay/config.yml` gate paths updated
- [ ] `plugin-packaging.test.mjs` passes (no experiment leakage)
- [ ] External workspace can run `quay gate --gate <name>` with custom paths

## Definition of Done

References the standard DoD clauses from `inherited-core.md` (13 clauses, single executable source: `scripts/it0-dod-check.ts`). Specific to this milestone:

- [ ] Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 1 Tier B
- [ ] 5 gates parameterized with CLI flags
- [ ] 5 gates + wrappers in `plugin/scripts/`
- [ ] `.quay/config.yml` updated
- [ ] Plugin packaging test passes
- [ ] Depends on DIR-070-B (Tier A gates must be in plugin/ first)

## Touches

- `experiments/scripts/` (5 gate .ts files -- parameterization)
- `plugin/scripts/` (5 gates + wrappers)
- `.quay/config.yml`
- `plugin/test/plugin-packaging.test.mjs`

## Not selected (M-136)

Capability-growth and deliverable:yes, but depends on DIR-070-A (symlinks) and DIR-070-B (Tier A gates) completing first. Will be eligible after those land.