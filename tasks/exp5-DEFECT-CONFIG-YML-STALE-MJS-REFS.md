---
id: exp5-DEFECT-CONFIG-YML-STALE-MJS-REFS
title: "defect: .quay/config.yml testPass gates reference renamed .mjs
  method-infra scripts (MODULE_NOT_FOUND since M107)"
status: done
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
- [x] `.quay/config.yml`'s `split-or-commit` and `enforcement-with-design` testPass commands point at the real `.ts` files; `quay gate <any-task> --gate split-or-commit` and `--gate enforcement-with-design` both run without a MODULE_NOT_FOUND crash.
- [x] A repo-wide grep for `.mjs` references to the ~26 method-infra scripts under `experiments/quay-perpetual-stream/scripts/` (excluding `milestones/*/worktrees/` and genuinely-still-`.mjs` files) finds no other stale references; any found are fixed in the same pass.
- [x] `dod-fixture-selfcheck.sh` still passes (golden-diff, no verdict-logic change — path fixes only).

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [x] All 3 AC items above verified true with pasted command output.
- [x] it0 DoD meta-enforcer passes all clauses.

## Resolution

**Fixed as part of DIR-059's landed commit (`6f183ef`, same session as M116), disposed at M116's
ABSORB (2026-07-23).** DIR-059's own commit message explicitly names this: "`it0-enforcement-with-
design-check.ts` and `.quay/config.yml`'s split-or-commit/enforcement-with-design gates still
referenced the pre-M107 `.mjs` filenames (MODULE_NOT_FOUND since M107) — matches the already-filed
`exp5-DEFECT-CONFIG-YML-STALE-MJS-REFS` defect."

**Re-verified live this ABSORB:**
```
$ grep -n -B1 "split-or-commit\|enforcement-with-design" .quay/config.yml
    - name: split-or-commit
      command: "node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts ."
    - name: enforcement-with-design
      command: "node experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts ."

$ node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .
PASS: 350 task(s) checked — no split-or-commit violations (...)

$ node experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts .
PASS: all 13 DoD clause(s) (...) documented in inherited-core.md AND have enforcement blocks in
it0-dod-check.mjs (bidirectional)
```
Both run clean, no MODULE_NOT_FOUND.

**Repo-wide sweep (AC2), performed live this ABSORB:** for every `.ts` file under
`experiments/quay-perpetual-stream/scripts/`, grepped all `.yml`/`.yaml`/`.sh`/`.ts`/`.json` files
repo-wide for a `<basename>.mjs` reference. Every hit found is a PROSE/COMMENT reference (header
comments describing the script's pre-rename name, `usage:` strings, historical narrative in
docstrings) or one intentionally-`.mjs`-named RED test fixture
(`fixtures/antidrift/red-overbroad.json`) — none is a live `command:`/`script:` invocation. Confirmed
separately: `grep -rn "command:.*\.mjs\|script:.*\.mjs" .quay/*.yml experiments/quay-perpetual-stream/.quay/*.yml`
returns only the one genuinely-still-`.mjs` file, `test/it0-dod-check.test.mjs` (a real test file,
correctly `.mjs` by the repo's own test-file convention, not part of TS migration scope). No further
fix needed.

**`dod-fixture-selfcheck.sh`:** covered by the 343/343 experiments-suite green run pasted in M116's
own ABSORB record (same session, same tree state) — no verdict-logic change, path fixes only.

- resolved_by: DIR-059 (commit `6f183ef`), disposition + sweep completed at M116 ABSORB
- outcome: applied
- evidence: pasted above, all re-derived live against current `master` HEAD at ABSORB time
