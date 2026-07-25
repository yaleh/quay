# Adversarial Acceptance Audit -- DIR-070-B (M137: Gap 1 Tier A -- 5 drop-in gates to plugin/scripts/)

**Audit session id:** m137-dir070b-audit-20260725-fresh
**Audit type:** adversarial acceptance audit (FRESH CONTEXT, refute-first stance)
**Task:** DIR-070-B (status: `needs-human` on master)
**Charter:** experiments/quay-perpetual-stream/charters/M137-tier-a-gates.md
**HEAD commit (master):** a8450e2 (DIR-070-B: fix absorb-entry gate sections + update iteration report, re-build 3)
**Date:** 2026-07-25
**Verdict: CONCERNS**

## Summary

Independent adversarial audit against the current master HEAD. All 8 target files (5 gate scripts + 3 `.sh` wrappers) are present in `plugin/scripts/`. All 5 Tier A gates are registered in `.quay/config.yml` pointing to `./plugin/scripts/` paths. `plugin-packaging.test.mjs` passes 24/24. The mechanical gate (`it0-dod-check.sh`) exits 0 (all 12 clauses satisfied). The implementation commit 09271a9 is merged on master. DIR-070-A prerequisite is `done` on master (commit b310adb).

Three concerns prevent a clean "NO REFUTATION FOUND" verdict:

1. **AC #9 literal violation (pre-existing, documented):** `worktree-branch-hygiene-check.sh` retains 6 functional references to `experiments/quay-perpetual-stream` / `exp5`. The AC text is categorical ("No experiments/... or exp5 in shipped plugin files") with no provision for functional-constant exceptions. 4 of 5 gates are clean.

2. **Legacy gates.yml dual-source-of-truth drift (pre-existing, documented):** `.quay/gates.yml` retains the old `./experiments/.../drivable-workspace-check.sh` path and lists NONE of the 4 fixed gates that were added to the unified `config.yml`. Gate resolution at runtime is correct (config.yml is authoritative per DIR-050), but a human reader looking at gates.yml sees stale data.

3. **NEW: Absorb entry lifecycle discrepancy:** The ABSORB entry (`/tmp/m137-absorb-entry.md`) claims `status: done` and `merge commit: 09271a9`, but the task on master is actually `status: needs-human`. The task was promoted to done in commit `11542df`, then reverted to `needs-human` in commit `a8450e2` (re-build 3) as part of fixing absorb-entry gate sections. The absorb entry was not updated to reflect this reversion. The implementation IS merged (09271a9 is on master) and all gates/tests pass, but the lifecycle record is stale relative to actual task state.

## AC Satisfaction (refute-first, fresh evidence gathered independently)

### AC 1: `anti-gaming-guard.ts` + `.sh` wrapper in `plugin/scripts/`
**STATUS: CONFIRMED -- no refutation found.**

- `plugin/scripts/anti-gaming-guard.ts`: present (3494 bytes, regular file). Zero experiment references (`grep -n 'experiments/quay-perpetual-stream\|exp5'` confirms clean).
- `plugin/scripts/anti-gaming-guard.sh`: present (844 bytes, regular file, `-rwxrwxr-x`). Zero experiment references. Delegates to `$(dirname "$0")/anti-gaming-guard.ts`.
- Gate resolves via `quay gate --gate anti-gaming DIR-070-B`: executes (exit 2 — missing args, NOT gate-not-found).

### AC 2: `loadbearing-test-gate.ts` + `.sh` wrapper in `plugin/scripts/`
**STATUS: CONFIRMED -- no refutation found.**

- `plugin/scripts/loadbearing-test-gate.ts`: present (13673 bytes, regular file). Zero experiment references.
- `plugin/scripts/loadbearing-test-gate.sh`: present (1418 bytes, regular file, `-rwxrwxr-x`). Zero experiment references. Delegates to `$(dirname "$0")/loadbearing-test-gate.ts`.
- Gate resolves via `quay gate --gate loadbearing-test DIR-070-B`: executes (exit 2 — missing args, NOT gate-not-found).

### AC 3: `tree-hygiene-check.sh` in `plugin/scripts/`
**STATUS: CONFIRMED -- no refutation found.**

- `plugin/scripts/tree-hygiene-check.sh`: present (1919 bytes, regular file, `-rwxrwxr-x`). Zero experiment references.
- Gate resolves via `quay gate --gate tree-hygiene DIR-070-B`: PASSES (exit 0).
- ROOT path correctly adjusted for the `plugin/scripts/` location.

### AC 4: `worktree-branch-hygiene-check.sh` in `plugin/scripts/`
**STATUS: CONFIRMED -- no refutation found (file present). CONCERN about AC #9.**

- `plugin/scripts/worktree-branch-hygiene-check.sh`: present (3323 bytes, regular file, `-rwxrwxr-x`).
- Gate resolves via `quay gate --gate worktree-branch-hygiene DIR-070-B`: PASSES (exit 0).
- ROOT path correctly adjusted for the `plugin/scripts/` location.
- **CONCERN (see AC #9):** Contains 6 functional references to experiment paths/branch patterns.

### AC 5: `drivable-workspace-check.ts` + `.sh` wrapper in `plugin/scripts/`
**STATUS: CONFIRMED -- no refutation found.**

- `plugin/scripts/drivable-workspace-check.ts`: present (10966 bytes, regular file). Zero experiment references.
- `plugin/scripts/drivable-workspace-check.sh`: present (636 bytes, regular file, `-rwxrwxr-x`). Zero experiment references.
- Gate resolves via `quay gate --gate drivable-workspace DIR-070-B`: executes (reports no arguments defined — gate found, NOT gate-not-found).

### AC 6: `.quay/config.yml` gate paths updated to plugin paths
**STATUS: CONFIRMED -- no refutation found. CONCERN about legacy gates.yml drift.**

All 5 Tier A gates in `.quay/config.yml` `gates:` section point to `./plugin/scripts/`:
- `anti-gaming` → `./plugin/scripts/anti-gaming-guard.sh` (fixed section)
- `loadbearing-test` → `./plugin/scripts/loadbearing-test-gate.sh` (fixed section)
- `tree-hygiene` → `./plugin/scripts/tree-hygiene-check.sh` (fixed section)
- `worktree-branch-hygiene` → `./plugin/scripts/worktree-branch-hygiene-check.sh` (fixed section)
- `drivable-workspace` → `./plugin/scripts/drivable-workspace-check.sh` (it0 section)

Verified by direct reading of `.quay/config.yml`. Gate resolution at runtime is correct — `loader.ts` lines 108-118 confirm that when `config.yml` has a `gates:` section, the legacy `gates.yml` is never consulted.

**CONCERN:** The legacy `.quay/gates.yml` has NOT been updated:
- `drivable-workspace` still points to `./experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh`
- None of the 4 fixed gates (`anti-gaming`, `loadbearing-test`, `tree-hygiene`, `worktree-branch-hygiene`) appear in the legacy file
- This is dual-source-of-truth drift — a human reader looking at `gates.yml` sees stale data. Non-functional (runtime is correct), but misleading.

### AC 7: All 5 gates runnable via `quay gate --gate <name>`
**STATUS: CONFIRMED -- no refutation found.**

All 5 gate names resolve and execute via `npx quay gate --gate <name> DIR-070-B`:
- `anti-gaming`: resolves, executes (exit 2 — missing required args, NOT gate-not-found)
- `loadbearing-test`: resolves, executes (exit 2 — missing required args, NOT gate-not-found)
- `tree-hygiene`: resolves, PASSES (exit 0)
- `worktree-branch-hygiene`: resolves, PASSES (exit 0)
- `drivable-workspace`: resolves, executes (reports "no drivable-workspace arguments defined" — gate found, NOT gate-not-found)

Test "DIR-070-B: all 5 gates runnable via quay gate --gate <name> (resolution check)" PASS (in plugin-packaging.test.mjs).

### AC 8: `plugin-packaging.test.mjs` passes (no experiment leakage in new files)
**STATUS: CONFIRMED -- no refutation found.**

Full test suite independent run: **24/24 PASS** (0 failures, 0 skipped, 0 cancelled):
```
tests 24
pass 24
fail 0
duration_ms 184.755394
```

All DIR-070-B-specific tests pass:
- "DIR-070-B: all 8 new gate scripts + wrappers present in plugin/scripts/" PASS
- "DIR-070-B: all .sh wrappers are executable" PASS
- "DIR-070-B: .sh wrappers runnable (exit 2 for missing args, not ENOTFOUND)" PASS
- "DIR-070-B: all 5 gates runnable via quay gate --gate <name> (resolution check)" PASS
- "DIR-070-B: universal-gate plugin files (4 of 5) have zero exp5/experiment-path references" PASS (documented exclusion for worktree-branch-hygiene-check.sh)

### AC 9: No `experiments/quay-perpetual-stream` or `exp5` in shipped plugin files
**STATUS: CONCERNS -- documented deviation, non-blocking. AC text is categorically violated for 1 of 5 files.**

Independent `grep` audit of all 8 shipped files:

| File | Experiment Refs | Status |
|---|---|---|
| `anti-gaming-guard.ts` | 0 | CLEAN |
| `anti-gaming-guard.sh` | 0 | CLEAN |
| `loadbearing-test-gate.ts` | 0 | CLEAN |
| `loadbearing-test-gate.sh` | 0 | CLEAN |
| `tree-hygiene-check.sh` | 0 | CLEAN |
| `drivable-workspace-check.ts` | 0 | CLEAN |
| `drivable-workspace-check.sh` | 0 | CLEAN |
| `worktree-branch-hygiene-check.sh` | **6** | **VIOLATION (documented)** |

The 6 references in `worktree-branch-hygiene-check.sh`:
- Line 7: `exp5-m07-iteration-0` (historical comment about orphaned worktrees)
- Line 12: `exp5-m<N>-iteration-<0|1>` (comment describing branch naming convention)
- Line 13: `experiments/quay-perpetual-stream/milestones/` (comment describing milestone evidence paths)
- Line 24: `MILESTONE_MD_PREFIX="experiments/quay-perpetual-stream/milestones/"` (functional constant — the path where milestone evidence is scanned)
- Line 28: `exp5-m<N>-iteration-<0|1>` (comment describing branch regex pattern)
- Line 30: `exp5-?m[0-9]+-.*iteration-[01]$` (functional constant — grep regex in iter_branches() for matching branch names)

4 of the 6 references (lines 24, 30) are functional constants without which the gate cannot operate. This gate must know branch naming conventions and milestone path prefixes to scan for orphaned evidence — it is inherently experiment-specific. The test acknowledges this with an explicit exemption.

**Impact:** Non-blocking. The 4 universal gates (anti-gaming, loadbearing-test, tree-hygiene, drivable-workspace) are fully clean. The worktree-branch-hygiene gate is functional but not universal — it hardcodes experiment-specific constants. An external quay workspace using this gate would need to adjust these.

## DoD Satisfaction

| # | DoD Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 1 Tier A | **CONFIRMED** | Task Proposal section references this doc. Charter scopes per "Gap 1 Tier A" from the same proposal doc. |
| 2 | 5 gate scripts + 3 `.sh` wrappers in `plugin/scripts/` | **CONFIRMED** | All 8 files verified present via independent `ls -la plugin/scripts/`. All are regular files (not symlinks). |
| 3 | `.quay/config.yml` updated | **CONFIRMED** | All 5 gate paths point to `./plugin/scripts/` in the `gates:` section. See AC #6. |
| 4 | Plugin packaging test updated and passing | **CONFIRMED** | 24/24 tests pass (independent run). DIR-070-B-specific tests in `plugin/test/plugin-packaging.test.mjs` all pass. |
| 5 | Depends on DIR-070-A | **CONFIRMED** | DIR-070-A status: `done` on master. Commit b310adb merged. 7 symlinks confirmed via `quay task view DIR-070-A`. |

## Mechanical Gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-070-B \
    experiments/quay-perpetual-stream/charters/M137-tier-a-gates.md \
    /tmp/m137-absorb-entry.md
EXIT_CODE=0
```

All 12 clauses satisfied:
- clause0-ac-dod-present: PASS (9/9 AC checked, DoD references standard)
- clause1-adversarial-audit: PASS (disposition statement present in absorb entry)
- clause2-vmeta-lag: PASS (disposition statement present)
- clause3-line-budget: PASS (within small-milestone norm)
- clause4-impl-row: PASS (not design-only)
- clause5-no-self-exemption: PASS
- clause6-escrow-delta-v: N/A (not design-only)
- clause7-test-floor: PASS (>=80% coverage disposition recorded)
- clause8-task-canonical-lifecycle-record: PASS
- clause9-split-or-commit: N/A (needs-human outcome — the done path is governed by clauses 0-8)
- clause10-tree-hygiene: PASS
- clause11-worktree-branch-hygiene: PASS
- clause12-audit-independence: N/A (no Audit-independence check section in absorb entry)

**Verdict: PASS (exit 0).** No clause violations.

## Concrete Evidence Index

| Evidence Item | Source | Method |
|---|---|---|
| 8 plugin files exist | `ls -la plugin/scripts/` | Direct filesystem listing |
| Files are regular, not symlinks | `test -L` per file | Shell stat |
| Zero experiment refs in 7 of 8 files | `grep -n 'experiments/quay-perpetual-stream\|exp5'` per file | Shell grep |
| config.yml gate paths | Direct read of `.quay/config.yml` | File read |
| Gate resolution | `npx quay gate --gate <name> DIR-070-B` | CLI invocation (x5 gates) |
| Plugin packaging test | `node --test plugin/test/plugin-packaging.test.mjs` | Test runner |
| Mechanical gate | `bash experiments/.../it0-dod-check.sh DIR-070-B ...` | Shell (exit 0) |
| DIR-070-A dependency | `npx quay task view DIR-070-A` + git log for b310adb | quay task view + git |
| Task lifecycle state | `npx quay task view DIR-070-B` | quay task view (status: needs-human) |
| Implementation commit presence | `git log --oneline master` | Git (09271a9 merged) |
| Absorb entry status claim | Direct read of `/tmp/m137-absorb-entry.md` | File read (claims "done") |

## Deviation Findings

### Finding 1: AC #9 literal violation -- worktree-branch-hygiene-check.sh experiment references
- **Level:** CONCERNS
- **Caught by:** machine (confirmed independently by this audit)
- **Caught at:** M137
- **AC:** #9 ("No `experiments/quay-perpetual-stream` or `exp5` in shipped plugin files")
- **Detail:** 6 references (4 functional constants + 2 historical comments) in `plugin/scripts/worktree-branch-hygiene-check.sh`. 4 of 5 gates are clean. The AC text is categorical with no provision for functional-constant exceptions. The test explicitly carves out an exclusion.
- **Already in dashboard:** row `DIR-070-B-AC9`, status `open`
- **This audit:** Confirmed unchanged from prior audits. References persist in the shipped file.

### Finding 2: Legacy gates.yml dual-source-of-truth drift
- **Level:** CONCERNS
- **Caught by:** machine (this audit pass)
- **Caught at:** M137
- **Detail:** `.quay/gates.yml` retains old `drivable-workspace` path (`./experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh`) and lists NONE of the 4 fixed gates (`anti-gaming`, `loadbearing-test`, `tree-hygiene`, `worktree-branch-hygiene`). The unified `.quay/config.yml` is the authoritative source (DIR-050) and the gate engine correctly ignores `gates.yml` when `config.yml` has a `gates:` section. Non-functional, but misleading for a human reader.
- **Already in dashboard:** row `DIR-070-B-gates-yml-drift`, status `open`
- **This audit:** Confirmed unchanged. Legacy file still stale.

### Finding 3: NEW -- Absorb entry lifecycle discrepancy
- **Level:** CONCERNS
- **Caught by:** machine (this audit pass)
- **Caught at:** M137
- **Detail:** The ABSORB entry (`/tmp/m137-absorb-entry.md`) claims `status: done` and `merge commit: 09271a9`, but the task on master is actually `status: needs-human`. The task was promoted to done in commit `11542df`, then reverted to `needs-human` in commit `a8450e2` (re-build 3 — "fix absorb-entry gate sections + update iteration report") as part of adding the AC #9 audit annotation. The implementation IS merged (09271a9 is on master), all 8 files are present, tests pass 24/24, mechanical gate exits 0. But the absorb entry's lifecycle claim is stale relative to the actual task state on master. The `needs-human` status appears intentional — the concerns (AC #9 violation, gates.yml drift) require human review/decision before the milestone can be considered fully closed.
- **Impact:** The absorb entry is stale. The outer loop or a human reading it would believe the task is `done` when it is `needs-human`. Either the absorb entry should be updated to reflect `needs-human` status, or the concerns should be resolved and the task promoted back to `done`.

## Overall Assessment

**Verdict: CONCERNS**

No AC is REFUTED (the implementation artifacts are correct and complete). All 5 gate scripts + 3 `.sh` wrappers exist in `plugin/scripts/`. All 5 gates resolve and are runnable via `quay gate --gate <name>`. The mechanical gate passes with zero clause violations. The plugin packaging test passes 24/24. DIR-070-A prerequisite is satisfied.

Three concerns prevent a clean "NO REFUTATION FOUND" verdict:

1. **AC #9 partial violation** (pre-existing): 1 of 5 gates retains 6 functional experiment references. The AC text does not permit functional-constant exceptions. The worktree-branch-hygiene gate is inherently experiment-specific by function.

2. **Legacy gates.yml drift** (pre-existing): The legacy fallback file is stale relative to the authoritative config.yml. Non-functional, but misleading.

3. **NEW: Absorb entry lifecycle discrepancy**: The absorb entry claims `status: done` but the task on master is `status: needs-human`, reverted in the re-build 3 commit (a8450e2). The absorb entry was not updated to reflect this reversion.

None of these concerns block accepting the implementation — the shipped artifacts are correct, tests pass, and the mechanical gate is satisfied. The concerns are about documentation, lifecycle record accuracy, and the tension between categorical AC text and functional reality.
