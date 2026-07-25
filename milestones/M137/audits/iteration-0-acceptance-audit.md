# Adversarial Acceptance Audit -- DIR-070-B (M137: Gap 1 Tier A -- 5 drop-in gates to plugin/scripts/)

**Audit session id:** m137-dir070b-audit-20260725
**Audit type:** adversarial acceptance audit (Clause 1, per inherited-core.md DoD)
**Task:** DIR-070-B (status: `done`)
**Charter:** experiments/quay-perpetual-stream/charters/M137-tier-a-gates.md
**Commit:** 09271a9 (DIR-070-B: ship 5 Tier-A gate scripts + 3 .sh wrappers to plugin/scripts/)
**Commit on master:** yes (verified via `git branch --contains 09271a9` -- `* master`)
**Date:** 2026-07-25
**Prior audit:** m137-dir070b-audit-20260725 (REFUTED by prior pass, resolved; CONCERNS carried forward)
**Verdict: CONCERNS**

## Summary

Fresh independent audit against commit `09271a9` (HEAD `11542df`, then `081b174` for evidence corrections).
All 8 target files (5 gate scripts + 3 `.sh` wrappers) are present in `plugin/scripts/`. All 5 Tier A
gates in `.quay/config.yml` point to `./plugin/scripts/` paths. All 5 DIR-070-B-specific tests in
`plugin-packaging.test.mjs` pass. The mechanical gate (`it0-dod-check.sh`) exits 0, confirming all 12
DoD clauses satisfied. DIR-070-A prerequisite is `done` (commit b310adb on master).

One CONCERN carried forward: AC #9 ("No `experiments/quay-perpetual-stream` or `exp5` in shipped
plugin files") is literally violated by `worktree-branch-hygiene-check.sh` (6 references). This was
documented by the prior audit, written to the dashboard deviation table (status: `open`), and remains
unresolved. No new deviations found in this pass.

## AC Satisfaction (refute-first, fresh evidence gathered independently)

| # | AC | Status | Evidence |
|---|-----|--------|----------|
| 1 | `anti-gaming-guard.ts` + `.sh` wrapper in `plugin/scripts/` | **CONFIRMED** | Both files present: `anti-gaming-guard.ts` (3494 bytes, 92 lines), `anti-gaming-guard.sh` (844 bytes, 24 lines, `-rwxrwxr-x`). `.sh` wrapper was authored new (no prior wrapper existed in `experiments/scripts/`). Tested present via `ls -la plugin/scripts/anti-gaming-guard.*`. |
| 2 | `loadbearing-test-gate.ts` + `.sh` wrapper in `plugin/scripts/` | **CONFIRMED** | Both files present: `loadbearing-test-gate.ts` (13673 bytes, 269 lines), `loadbearing-test-gate.sh` (1418 bytes, 31 lines, `-rwxrwxr-x`). Copied from `experiments/scripts/`; `.sh` wrapper sanitized (stripped `exp5-` attribution prefix per diff). Verified zero experiment references via `grep 'experiments/quay-perpetual-stream\|exp5'`. |
| 3 | `tree-hygiene-check.sh` in `plugin/scripts/` | **CONFIRMED** | File present: `tree-hygiene-check.sh` (1919 bytes, 35 lines, `-rwxrwxr-x`). Copied + sanitized (HERE/ROOT navigation uses `$HERE/../..`). Zero experiment references (grep returns no matches). |
| 4 | `worktree-branch-hygiene-check.sh` in `plugin/scripts/` | **CONFIRMED** | File present: `worktree-branch-hygiene-check.sh` (3323 bytes, 63 lines, `-rwxrwxr-x`). Copied + sanitized (ROOT path: `$HERE/../..`). Differs from `plugin/gate-scripts/` copy only in ROOT navigation depth. |
| 5 | `drivable-workspace-check.ts` + `.sh` wrapper in `plugin/scripts/` | **CONFIRMED** | Both files present: `drivable-workspace-check.ts` (10966 bytes, 234 lines), `drivable-workspace-check.sh` (636 bytes, 23 lines, `-rwxrwxr-x`). Zero experiment references (grep returns no matches). |
| 6 | `.quay/config.yml` gate paths updated to plugin paths | **CONFIRMED** | All 5 Tier A gates point to `./plugin/scripts/`: `anti-gaming` (fixed: L57), `loadbearing-test` (fixed: L59), `tree-hygiene` (fixed: L61), `worktree-branch-hygiene` (fixed: L63), `drivable-workspace` (it0: L46). No `./experiments/...` paths for these 5 gates. Verified by reading `.quay/config.yml` directly. |
| 7 | All 5 gates runnable via `quay gate --gate <name>` | **CONFIRMED** | Test "DIR-070-B: all 5 gates runnable via quay gate --gate <name> (resolution check)" PASS (0.361ms). All 5 gate names resolve in config. |
| 8 | `plugin-packaging.test.mjs` passes (no experiment leakage in new files) | **CONFIRMED** | All 5 DIR-070-B sub-tests pass (verified: `node --test --test-name-pattern="DIR-070-B" plugin/test/plugin-packaging.test.mjs` -- 5/5 PASS). Overall suite: 23/24 pass, 1 pre-existing unrelated failure (M143 workflow byte-identity). DIR-070-B sub-tests: file presence (PASS), wrapper executability (PASS), wrapper runnability (PASS), gate resolution (PASS), experiment-reference leak check on 4 universal-gate files (PASS). |
| 9 | No `experiments/quay-perpetual-stream` or `exp5` in shipped plugin files | **CONCERNS** | 4 of 5 gates are clean (zero references, verified via `grep`). **`worktree-branch-hygiene-check.sh` contains 6 references** to `experiments/quay-perpetual-stream` or `exp5` (lines 7, 12, 13, 24, 28, 30). Breakdown: 2 historical comments (lines 7: `exp5-m07-iteration-0`, 12: `exp5-m<N>-iteration-<0|1>`), 4 functional constants (lines 13: path mention in comment, 24: `MILESTONE_MD_PREFIX="experiments/quay-perpetual-stream/milestones/"`, 28: comment with `exp5-`, 30: `exp5-` in branch regex). The test explicitly carves out this file ("excluded -- it NEEDS experiment-specific references"). See Deviation Finding #1. |

## DoD Satisfaction

| # | DoD Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 1 Tier A | **CONFIRMED** | Proposal doc references Gap 1 (section lines ~75-102, gate scripts from experiments/scripts/ to plugin/scripts/). Charter explicitly scopes per "Gap 1 Tier A." Task Proposal links the proposal doc. |
| 2 | 5 gate scripts + 3 `.sh` wrappers in `plugin/scripts/` | **CONFIRMED** | All 8 files present and accounted: 5 gate scripts + 3 `.sh` wrappers. Verified via `ls -la plugin/scripts/`. |
| 3 | `.quay/config.yml` updated | **CONFIRMED** | 5 plugin paths confirmed. See AC #6 for per-gate path evidence. |
| 4 | Plugin packaging test updated and passing | **CONFIRMED** | Test updated with DIR-070-B test block (lines 129-191, 5 tests). All 5 pass. |
| 5 | Depends on DIR-070-A (symlinks in place, status `done`, commit b310adb) | **CONFIRMED** | DIR-070-A: `status: done` (task frontmatter), merged at commit b310adb ("M136 (DIR-070-A): dual-copy resolution -- sync-vendor --check + 7 symlinks"), 7 symlinks confirmed in `experiments/scripts/` by prior audit. |

## Mechanical Gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-070-B \
    experiments/quay-perpetual-stream/charters/M137-tier-a-gates.md \
    /tmp/m137-absorb-entry.md

PASS: clause0-ac-dod-present: task AC has 9 checkable clause(s) (checklist-form, 9/9 checked); DoD references the standard [tasks/DIR-070-B.md]
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS -- scope within the small-milestone norm
PASS: clause4-impl-row: PASS -- DIR-070-B is not design-only, impl-row does not apply
PASS: clause5-no-self-exemption: no undeclared self-exemption language found
PASS: clause6-escrow-delta-v: N/A -- milestone is not design-only
PASS: clause7-test-floor: N/A -- surface label [packaging] exclusively non-product-touching
PASS: clause8-task-canonical-lifecycle-record: task carries real Proposal (265 chars) and Plan
PASS: clause10-tree-hygiene: PASS -- clean
PASS: clause11-worktree-branch-hygiene: PASS -- clean
PASS: clause12-audit-independence: N/A (no Audit-independence section in absorb-entry)
N/A: clause9-split-or-commit

PASS: DoD check passed -- all clauses satisfied (12 disposition(s) confirmed)
EXIT CODE: 0
```

Gate passes cleanly. Exit 0 = NOT REFUTED by construction.

## Deviation Findings

### Finding #1 (CONCERNS, carried forward): AC #9 literal violation -- experiment references in shipped file

**Level:** CONCERNS
**caught-by:** machine
**caught-at:** M137
**AC violated:** #9 ("No `experiments/quay-perpetual-stream` or `exp5` in shipped plugin files")
**Dashboard row:** DIR-070-B-AC9 (status: `open`, age: 0)
**Evidence:** `plugin/scripts/worktree-branch-hygiene-check.sh` contains 6 lines matching
`experiments/quay-perpetual-stream` or `exp5` (lines 7, 12, 13, 24, 28, 30).

**Reference breakdown:**
- Line 7: `exp5-m07-iteration-0` -- historical comment (observation of prior drift)
- Line 12: `exp5-m<N>-iteration-<0|1>` -- branch naming convention in comment
- Line 13: `experiments/quay-perpetual-stream/milestones/` -- path reference in comment
- Line 24: `MILESTONE_MD_PREFIX="experiments/quay-perpetual-stream/milestones/"` -- **functional constant** (operational: locates milestone files)
- Line 28: `exp5-` -- legacy prefix in comment
- Line 30: `grep -E '^(exp5-)?m[0-9]+-.*iteration-[01]$'` -- **functional regex** (operational: matches iteration branch names)

**Test carve-out:** `plugin-packaging.test.mjs` line 265: "worktree-branch-hygiene-check.sh is
excluded -- it NEEDS experiment-specific references (branch-name pattern, milestone-path prefix)
as functional constants." The test only checks the other 4 gates for leakage and passes.

**Impact:** Non-blocking. The 4 functional references are operational string constants, not
import/dependency leaks. The gate's operational domain IS experiment-milestone hygiene, so these
constants are inherent. An external workspace running quay in a BAIME-style loop would need to
adjust these values. The 2 historical comment references are harmless. The 4 remaining gates
shipped clean (zero experiment references).

**Tension:** AC #9 is categorical ("No... references") with no provision for functional exceptions.
The test enforcement contradicts the AC specification (test says "no references EXCEPT this file").
The resolution should be at the source: amend the AC to acknowledge functional-reference exceptions
for gates whose operational domain is milestone-hygiene, or parameterize the milestone prefix and
branch pattern externally. Status remains `open` in the dashboard deviation table.

### Finding #2 (NOTE, non-blocking): Pre-existing overall test suite failure

The `plugin-packaging.test.mjs` suite exits 1 due to an unrelated M143 test failure ("M143:
git-tracked workflows in plugin/workflows/ are byte-identical to .claude/workflows/ canonical
sources"). All DIR-070-B sub-tests pass cleanly. This is pre-existing, not introduced by DIR-070-B.

## Prior Deviation Row Status

The prior dashboard deviation row `DIR-070-B-original` (REFUTED, "acceptance audit found ZERO
implementation") is now `verified-eliminated` -- implementation commit `09271a9` exists on master
with all 8 target files, config updates, and test updates. Task is `status: done`, mechanical
gate exit 0.

The `DIR-070-B-AC9` row (CONCERNS, "AC #9 literal violation -- experiment references in
worktree-branch-hygiene-check.sh") remains `open` -- the underlying tension between AC text and
test carve-out has not been resolved. This audit does not escalate it to REFUTED because the
violation is acknowledged, documented, and non-blocking for this milestone's deliverable.

## Direct Evidence Sources (independent, not implementer self-report)

- `ls -la plugin/scripts/` -- confirms all 8 files present with file sizes and permissions
- `grep -c 'experiments/quay-perpetual-stream\|exp5' plugin/scripts/<each file>` -- per-file leak check (4 clean, 1 has 6 refs)
- `grep 'plugin/scripts/' .quay/config.yml` -- confirms 5 plugin paths in gate config
- `node --test --test-name-pattern="DIR-070-B" plugin/test/plugin-packaging.test.mjs` -- 5/5 PASS
- `node --test plugin/test/plugin-packaging.test.mjs` -- 23/24 (1 pre-existing M143 failure)
- `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh ...` -- exit 0, all 12 clauses satisfied
- `git log --oneline -5 | grep DIR-070-B` -- confirms commits 09271a9, 11542df, 081b174
- `git branch --contains 09271a9` -- confirms commit is on `* master`
- `task_get DIR-070-A` via MCP -- confirms prerequisite task `status: done`
- `ls -la plugin/scripts/*.sh` -- confirms all 7 `.sh` files are executable
