# Adversarial Acceptance Audit -- DIR-070-B (M137: Gap 1 Tier A -- 5 drop-in gates to plugin/scripts/)

**Audit session id:** m137-dir070b-audit-20260725
**Audit type:** adversarial acceptance audit (Clause 1, per inherited-core.md DoD)
**Task:** DIR-070-B (status: `done`)
**Charter:** experiments/quay-perpetual-stream/charters/M137-tier-a-gates.md
**Commit:** 09271a9 (DIR-070-B: ship 5 Tier-A gate scripts + 3 .sh wrappers to plugin/scripts/)
**Date:** 2026-07-25
**Verdict: CONCERNS**

## Summary

This audit supersedes the prior audit of 2026-07-25 (which found zero implementation, REFUTED).
Implementation commit `09271a9` exists on master (HEAD: `11542df`). All 8 target files (5 gate
scripts + 3 `.sh` wrappers) are present in `plugin/scripts/`. `.quay/config.yml` gates point to
`./plugin/scripts/` for all 5 Tier A gates. `plugin-packaging.test.mjs` includes 5 DIR-070-B
tests, all passing. The mechanical gate (`it0-dod-check.sh`) exits 0, confirming all 12 DoD
clauses.

One CONCERN: AC #9 ("No `experiments/quay-perpetual-stream` or `exp5` in shipped plugin files")
is literally violated by `worktree-branch-hygiene-check.sh` (6 references). The implementer
documented this as intentional -- the gate requires these references as functional constants
(branch naming regex, milestone path prefix). The test carves out a documented exception. The AC
text is categorical and should have anticipated this exception.

## AC Satisfaction (refute-first, fresh evidence)

| # | AC | Status | Evidence |
|---|-----|--------|----------|
| 1 | `anti-gaming-guard.ts` + `.sh` wrapper in `plugin/scripts/` | **CONFIRMED** | Both files exist: `plugin/scripts/anti-gaming-guard.ts` (3494 bytes, 92 lines), `plugin/scripts/anti-gaming-guard.sh` (844 bytes, 24 lines, executable). Commit 09271a9. `anti-gaming-guard.sh` was AUTHORED new (no prior wrapper existed). Test "DIR-070-B: all 8 new gate scripts + wrappers present in plugin/scripts/" PASS. |
| 2 | `loadbearing-test-gate.ts` + `.sh` wrapper in `plugin/scripts/` | **CONFIRMED** | Both files exist: `plugin/scripts/loadbearing-test-gate.ts` (13673 bytes, 269 lines), `plugin/scripts/loadbearing-test-gate.sh` (1418 bytes, 31 lines, executable). Copied from experiments/scripts/; `.sh` wrapper sanitized (stripped `exp5-` attribution prefix). Test PASS. |
| 3 | `tree-hygiene-check.sh` in `plugin/scripts/` | **CONFIRMED** | File exists: `plugin/scripts/tree-hygiene-check.sh` (1919 bytes, 35 lines, executable). Copied + sanitized (usage line, HERE/ROOT navigation). Has zero experiment references (verified: `grep` returns no matches for `experiments/quay-perpetual-stream` or `exp5`). Test PASS. |
| 4 | `worktree-branch-hygiene-check.sh` in `plugin/scripts/` | **CONFIRMED** | File exists: `plugin/scripts/worktree-branch-hygiene-check.sh` (3323 bytes, 63 lines, executable). Copied + sanitized (HERE/ROOT navigation fixed). Differs from `plugin/gate-scripts/` copy only in ROOT path (`../..` vs `../../..`). Test PASS. |
| 5 | `drivable-workspace-check.ts` + `.sh` wrapper in `plugin/scripts/` | **CONFIRMED** | Both files exist: `plugin/scripts/drivable-workspace-check.ts` (10966 bytes, 234 lines), `plugin/scripts/drivable-workspace-check.sh` (636 bytes, 23 lines, executable). Copied clean (zero experiment references). Test PASS. |
| 6 | `.quay/config.yml` gate paths updated to plugin paths | **CONFIRMED** | All 5 Tier A gates point to `./plugin/scripts/` paths: `anti-gaming` (line 57), `loadbearing-test` (line 59), `tree-hygiene` (line 61), `worktree-branch-hygiene` (line 63) under `fixed:` gate set; `drivable-workspace` (line 46) under `it0:` gate set. Zero `./experiments/...` paths for these 5 gates. |
| 7 | All 5 gates runnable via `quay gate --gate <name>` | **CONFIRMED** | Test "DIR-070-B: all 5 gates runnable via quay gate --gate <name> (resolution check)" PASS. All 5 gate names (`anti-gaming`, `loadbearing-test`, `tree-hygiene`, `worktree-branch-hygiene`, `drivable-workspace`) resolve in `.quay/config.yml`. |
| 8 | `plugin-packaging.test.mjs` passes (no experiment leakage in new files) | **CONFIRMED** | All 5 DIR-070-B-specific tests pass (verified via `node --test --test-name-pattern="DIR-070-B" plugin/test/plugin-packaging.test.mjs`). The overall suite has 1 unrelated pre-existing failure (M143 workflow byte-identity). The DIR-070-B sub-tests include: file presence (PASS), wrapper executability (PASS), wrapper runnability (PASS), gate resolution (PASS), experiment-reference leak check on 4 universal-gate files (PASS). |
| 9 | No `experiments/quay-perpetual-stream` or `exp5` in shipped plugin files | **CONCERNS** | 4 of 5 gates are clean (zero references, confirmed by `grep`). **`worktree-branch-hygiene-check.sh` contains 6 references** (lines 7, 12, 13, 24, 28, 30) to `experiments/quay-perpetual-stream` or `exp5`. These are functional constants: branch naming regex patterns (`exp5-m<N>-iteration-<0\|1>`), milestone path prefix (`MILESTONE_MD_PREFIX`), and historical comment references. The implementer documented this as intentional in the commit message and the test carves out a documented exception. The AC text is categorical and does not provide for this exception. See Deviation Finding #1 below. |

## DoD Satisfaction

| # | DoD Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 1 Tier A | **CONFIRMED** | Proposal doc exists. Section at lines 75-102 discusses moving gate scripts from `experiments/scripts/` to `plugin/scripts/`. Section at line 192 lists "Move gate scripts to `plugin/scripts/` -- Gap 1" as a prioritized item. The phrase "Tier A" is from the milestone charter's tier classification, not the proposal doc itself -- the proposal uses "Gap 1." |
| 2 | 5 gate scripts + 3 `.sh` wrappers in `plugin/scripts/` | **CONFIRMED** | All 8 files present: 5 gate scripts (`anti-gaming-guard.ts`, `loadbearing-test-gate.ts`, `tree-hygiene-check.sh`, `worktree-branch-hygiene-check.sh`, `drivable-workspace-check.ts`) + 3 wrappers (`anti-gaming-guard.sh`, `loadbearing-test-gate.sh`, `drivable-workspace-check.sh`). Test PASS. |
| 3 | `.quay/config.yml` updated | **CONFIRMED** | 5 gate entries point to `./plugin/scripts/...` paths. See AC #6 for per-gate evidence. |
| 4 | Plugin packaging test updated and passing | **CONFIRMED** | Test updated with DIR-070-B test block (5 tests, 106 insertions). All 5 DIR-070-B tests pass. Overall suite has 1 pre-existing unrelated failure (M143 workflow byte-identity drift). |
| 5 | Depends on DIR-070-A | **CONFIRMED** | DIR-070-A is `status: done`, merged to master (commit b310adb). 7 symlinks confirmed in `experiments/scripts/`. Verified via task frontmatter read. |

## Mechanical Gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-070-B \
    experiments/quay-perpetual-stream/charters/M137-tier-a-gates.md \
    /tmp/m137-absorb-entry.md

PASS: clause0-ac-dod-present: task AC has 9 checkable clause(s) (checklist-form, 9/9 checked)
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS
PASS: clause4-impl-row: PASS (DIR-070-B is not design-only, impl-row does not apply)
PASS: clause5-no-self-exemption: no undeclared self-exemption language found
PASS: clause6-escrow-delta-v: N/A (milestone is not design-only)
PASS: clause7-test-floor: N/A (surface label [packaging], exclusively non-product-touching)
PASS: clause8-task-canonical-lifecycle-record: task carries real Proposal (265 chars) and Plan
PASS: clause10-tree-hygiene: PASS -- clean
PASS: clause11-worktree-branch-hygiene: PASS -- clean
PASS: clause12-audit-independence: N/A (no Audit-independence section in absorb-entry)
N/A: clause9-split-or-commit

PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed)
EXIT CODE: 0
```

Gate passes cleanly. Exit 0 = NOT REFUTED by construction.

## Deviation Findings

### Finding #1 (CONCERNS): AC #9 literal violation -- experiment references in shipped file

**Level:** CONCERNS
**AC violated:** #9 ("No `experiments/quay-perpetual-stream` or `exp5` in shipped plugin files")
**Evidence:** `plugin/scripts/worktree-branch-hygiene-check.sh` contains 6 lines matching
`experiments/quay-perpetual-stream` or `exp5` (lines 7, 12, 13, 24, 28, 30).
**Test carve-out:** `plugin-packaging.test.mjs` line 265: "worktree-branch-hygiene-check.sh is
excluded — it NEEDS experiment-specific references (branch-name pattern, milestone-path prefix)
as functional constants." The test only checks the other 7 files for leakage.

**Analysis:** The references fall into two categories:
1. **Functional constants** (4 refs, lines 13, 24, 28, 30): `MILESTONE_MD_PREFIX` is set to
   `experiments/quay-perpetual-stream/milestones/` and is used operationally to locate milestone
   files. The branch regex `^(exp5-)?m[0-9]+-.*iteration-[01]$` matches iteration branch names.
   Without these, the gate cannot perform its worktree hygiene check.
2. **Historical comments** (2 refs, lines 7, 12): Describing the gate's origin and prior
   observations (`exp5-m07-iteration-0`). These are harmless but are literal experiments/exp5
   references.

**Impact assessment:** The 4 functional references are NOT import/dependency leaks -- they do
not import code or require experiment infrastructure. They are operational string constants that
parameterize what directory and branch pattern the gate checks. An external workspace running
quay in a BAIME-style loop with milestone directories would need to adjust these anyway. The
2 historical comment references are harmless documentation.

**Recommendation:** Either (a) amend the AC to acknowledge functional-reference exceptions for
gates whose operational domain IS experiment-milestone hygiene, or (b) parameterize the
milestone prefix and branch pattern so they can be configured externally. The current test
carve-out is a pragmatic solution but makes the AC self-contradictory (the AC says "no
references, period" while the test says "no references EXCEPT this one file"). This tension
should be resolved at the source (AC text), not just in the enforcement mechanism (test).

### Finding #2 (NOTE, non-blocking): Pre-existing overall test suite failure

The `plugin-packaging.test.mjs` file as a whole exits 1 due to an unrelated M143 test failure
("M143: git-tracked workflows in plugin/workflows/ are byte-identical to .claude/workflows/
canonical sources"). All DIR-070-B sub-tests (run via `--test-name-pattern="DIR-070-B"`) pass
cleanly (5/5). This is a pre-existing condition, not introduced by DIR-070-B.

## Prior Deviation Row Resolution

The pre-existing dashboard deviation row for DIR-070-B (REFUTED, "acceptance audit found ZERO
implementation") is now **resolved**. Implementation commit `09271a9` exists on master with all
8 target files, config updates, and test updates. The task is `status: done`. This audit's
CONCERNS finding (AC #9) replaces the prior REFUTED finding.

## Direct Evidence Sources (independent, not implementer self-report)

- `ls -la plugin/scripts/` -- confirms all 8 files exist with correct timestamps and sizes
- `grep -c 'experiments/quay-perpetual-stream\|exp5' plugin/scripts/<file>` -- per-file leak check
- `grep 'plugin/scripts/' .quay/config.yml` -- confirms 5 plugin paths in gate config
- `node --test --test-name-pattern="DIR-070-B" plugin/test/plugin-packaging.test.mjs` -- 5/5 PASS
- `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh ...` -- exit 0, all clauses PASS
- `git log --oneline --diff-filter=A -- plugin/scripts/anti-gaming-guard.ts ...` -- commit 09271a9
- `node -e "..." tasks/DIR-070-A.md` -- confirms DIR-070-A status is `done`
- `diff plugin/scripts/worktree-branch-hygiene-check.sh plugin/gate-scripts/worktree-branch-hygiene-check.sh` -- confirms ROOT navigation difference only
