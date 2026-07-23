---
id: exp5-DEFECT-CONFIG-YML-STALE-MJS-REFS
title: "defect: .quay/config.yml testPass gates reference renamed .mjs
  method-infra scripts (MODULE_NOT_FOUND since M107)"
status: todo
labels:
  - milestone-candidate
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Found while working on P5-A (M116): `.quay/config.yml`'s `gates.testPass` section still references
2 method-infra scripts by their PRE-M107 `.mjs` filenames, which no longer exist (renamed to `.ts` at
M107 Batch 2):

```
- name: split-or-commit
  command: "node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.mjs ."
- name: enforcement-with-design
  command: "node experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.mjs ."
```

Confirmed genuinely broken:
```
$ node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.mjs .
Error: Cannot find module '.../it0-split-or-commit-check.mjs'
code: 'MODULE_NOT_FOUND'
```
Real files are `it0-split-or-commit-check.ts` / `it0-enforcement-with-design-check.ts`. This means
the `split-or-commit` and `enforcement-with-design` `testPass` gates in `.quay/config.yml` have been
silently broken since M107 — any milestone that ran `quay gate <task> --gate split-or-commit` (or
`enforcement-with-design`) via this config-driven testPass wrapper would have hit this crash, not a
real PASS/FAIL verdict. (The direct script invocations `node .../it0-split-or-commit-check.ts .` used
throughout M114/M115/M116 work fine — this is specifically about the `.quay/config.yml`-wired
`testPass` gate path, a different invocation surface.)

This is the SAME root-cause CLASS as the M109 import-specifier bug fixed at M114 (a rename landed
without a full reference sweep) — but a different concrete location, so filed separately rather than
folded into that already-closed task.

## Plan
N/A — two one-line path fixes (`.mjs` → `.ts`) in `.quay/config.yml`, plus a broader grep sweep for
any OTHER stale `.mjs` references to now-`.ts`-only method-infra scripts across the repo (config
files, shell scripts, JSON fixtures) before closing, since this is the second such bug found and a
full sweep is cheaper than finding a third one file-by-file.

## Acceptance Criteria
- [ ] `.quay/config.yml`'s `split-or-commit` and `enforcement-with-design` testPass commands point at the real `.ts` files; `quay gate <any-task> --gate split-or-commit` and `--gate enforcement-with-design` both run without a MODULE_NOT_FOUND crash.
- [ ] A repo-wide grep for `.mjs` references to the ~26 method-infra scripts under `experiments/quay-perpetual-stream/scripts/` (excluding `milestones/*/worktrees/` and genuinely-still-`.mjs` files) finds no other stale references; any found are fixed in the same pass.
- [ ] `dod-fixture-selfcheck.sh` still passes (golden-diff, no verdict-logic change — path fixes only).

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [ ] All 3 AC items above verified true with pasted command output.
- [ ] it0 DoD meta-enforcer passes all clauses.
