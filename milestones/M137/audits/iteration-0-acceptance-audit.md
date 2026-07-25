# Adversarial Acceptance Audit -- DIR-070-B (M137: Gap 1 Tier A -- 5 drop-in gates to plugin/scripts/)

**Audit session id:** m137-dir070b-audit-20260725-reaudit
**Audit type:** adversarial acceptance audit (Clause 1, per inherited-core.md DoD — FRESH CONTEXT)
**Task:** DIR-070-B (status: `done`)
**Charter:** experiments/quay-perpetual-stream/charters/M137-tier-a-gates.md
**HEAD commit (master):** 581e330 (DIR-070-B: fix M143 workflow byte-identity drift + update iteration report)
**Date:** 2026-07-25
**Verdict: CONCERNS**

## Summary

Independent adversarial audit against the current master HEAD. All 8 target files (5 gate scripts + 3 `.sh` wrappers) are present in `plugin/scripts/` as regular (non-symlink) copies. The 3 `.ts` gate scripts are byte-identical to their `experiments/quay-perpetual-stream/scripts/` counterparts; the 2 `.sh` gate scripts have correct ROOT-path adjustments (`$HERE/../../..` → `$HERE/../..`) for the new location. All 5 Tier A gates in `.quay/config.yml` point to `./plugin/scripts/` paths. The mechanical gate (`it0-dod-check.sh`) exits 0, confirming all 12 DoD clauses satisfied. `plugin-packaging.test.mjs` passes 24/24 (100%), including all 6 DIR-070-B-specific tests. DIR-070-A prerequisite is `done` (commit b310adb on master, 7 symlinks confirmed in `experiments/scripts/`).

Two CONCERNS carried forward:
1. **AC #9 partial violation (documented, non-blocking):** `worktree-branch-hygiene-check.sh` retains 6 functional references to `experiments/quay-perpetual-stream` / `exp5`. 4 of 5 gates are clean; this deviation was acknowledged by the test (explicit exclusion from zero-leak check) and recorded in the dashboard deviation table. This gate is NOT universal — it hardcodes experiment-specific branch patterns and milestone path prefixes that won't work in an external quay workspace without reconfiguration.
2. **Legacy gates.yml dual-source-of-truth drift:** `.quay/gates.yml` still retains the old `./experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh` path for `drivable-workspace` and lists NONE of the 4 fixed gates (`anti-gaming`, `loadbearing-test`, `tree-hygiene`, `worktree-branch-hygiene`) that were added to the unified `config.yml`. While the gate engine (`loader.ts` lines 108-118) correctly prioritizes the unified `config.yml` (it is the SINGLE SOURCE OF TRUTH per DIR-050), the stale legacy file is misleading for a human reader. Either synchronize or remove the legacy file.

## AC Satisfaction (refute-first, fresh evidence gathered independently)

### AC 1: `anti-gaming-guard.ts` + `.sh` wrapper in `plugin/scripts/`
**STATUS: CONFIRMED -- no refutation found.**

- `anti-gaming-guard.ts`: present (3494 bytes, regular file), zero experiment references (`grep -n 'experiments/quay-perpetual-stream\|exp5'` returns no matches), byte-identical to `experiments/quay-perpetual-stream/scripts/anti-gaming-guard.ts` (md5sum match).
- `anti-gaming-guard.sh`: present (844 bytes, regular file, `-rwxrwxr-x`), zero experiment references, properly delegates to `$(dirname "$0")/anti-gaming-guard.ts`.
- Test "DIR-070-B: all 8 new gate scripts + wrappers present in plugin/scripts/" PASS.
- Test "DIR-070-B: .sh wrappers runnable (exit 2 for missing args, not ENOTFOUND)" PASS for anti-gaming-guard.sh.

### AC 2: `loadbearing-test-gate.ts` + `.sh` wrapper in `plugin/scripts/`
**STATUS: CONFIRMED -- no refutation found.**

- `loadbearing-test-gate.ts`: present (13673 bytes, regular file), zero experiment references, byte-identical to `experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.ts` (md5sum match).
- `loadbearing-test-gate.sh`: present (1418 bytes, regular file, `-rwxrwxr-x`), zero experiment references, properly delegates to `$(dirname "$0")/loadbearing-test-gate.ts`.
- Test confirms presence and runnability.

### AC 3: `tree-hygiene-check.sh` in `plugin/scripts/`
**STATUS: CONFIRMED -- no refutation found.**

- `tree-hygiene-check.sh`: present (1919 bytes, regular file, `-rwxrwxr-x`), zero experiment references.
- ROOT path correctly adjusted: `$HERE/../../..` → `$HERE/../..` (both resolve to `/home/yale/work/quay`, verified by direct shell resolution).
- Usage line updated from `experiments/quay-perpetual-stream/scripts/` to `plugin/scripts/`.
- Differs from `experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` by exactly 2 lines (ROOT path and usage line) — correct location-aware adjustments.

### AC 4: `worktree-branch-hygiene-check.sh` in `plugin/scripts/`
**STATUS: CONFIRMED -- no refutation found. File is present and functional.**

- `worktree-branch-hygiene-check.sh`: present (3323 bytes, regular file, `-rwxrwxr-x`).
- ROOT path correctly adjusted: `$HERE/../../..` → `$HERE/../..`.
- Differs from `experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh` by exactly 1 line (ROOT path) — correct location-aware adjustment.
- **CONCERNS (see AC #9):** Contains 6 functional references to experiment paths/branch patterns (documented deviation).

### AC 5: `drivable-workspace-check.ts` + `.sh` wrapper in `plugin/scripts/`
**STATUS: CONFIRMED -- no refutation found.**

- `drivable-workspace-check.ts`: present (10966 bytes, regular file), zero experiment references, byte-identical to `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts` (md5sum match).
- `drivable-workspace-check.sh`: present (636 bytes, regular file, `-rwxrwxr-x`), zero experiment references, properly delegates to `$(dirname "$0")/drivable-workspace-check.ts`.
- Test confirms presence, executability, and zero-leak.

### AC 6: `.quay/config.yml` gate paths updated to plugin paths
**STATUS: CONFIRMED -- no refutation found. CONCERN about legacy gates.yml drift.**

All 5 Tier A gates in `.quay/config.yml` point to `./plugin/scripts/`:
- `anti-gaming` → `./plugin/scripts/anti-gaming-guard.sh` (fixed section)
- `loadbearing-test` → `./plugin/scripts/loadbearing-test-gate.sh` (fixed section)
- `tree-hygiene` → `./plugin/scripts/tree-hygiene-check.sh` (fixed section)
- `worktree-branch-hygiene` → `./plugin/scripts/worktree-branch-hygiene-check.sh` (fixed section)
- `drivable-workspace` → `./plugin/scripts/drivable-workspace-check.sh` (it0 section, `argsKey: drivableWorkspaceArgs`)

Verified by direct reading of `.quay/config.yml`. Test "DIR-070-B: all 5 gates runnable via quay gate --gate <name> (resolution check)" PASS.

**CONCERN (non-blocking):** The legacy `.quay/gates.yml` has NOT been updated:
- `drivable-workspace` still points to `./experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh`
- None of the 4 fixed gates appear in the legacy file
- The legacy file's own header claims it is "WORKSPACE-OWNED gate data", but the actual authoritative data is now in `config.yml` per DIR-050

Gate resolution (`loader.ts` lines 108-118): when `config.yml` exists and has a `gates:` section, the legacy `gates.yml` is NEVER consulted — confirmed by reading the source code and by verifying all 5 gates resolve correctly at runtime. However, this is dual-source-of-truth drift that could mislead a human reader.

### AC 7: All 5 gates runnable via `quay gate --gate <name>`
**STATUS: CONFIRMED -- no refutation found.**

All 5 gate names resolve and execute via `node packages/quay/dist/quay.js gate --gate <name> DIR-070-B`:
- `anti-gaming`: resolves, executes (exit 2 — missing args, NOT gate-not-found)
- `loadbearing-test`: resolves, executes (exit 2 — missing args, NOT gate-not-found)
- `tree-hygiene`: resolves, PASSES (exit 0)
- `worktree-branch-hygiene`: resolves, PASSES (exit 0)
- `drivable-workspace`: resolves, executes (reports "no drivable-workspace arguments defined" — gate found, NOT gate-not-found)

Test "DIR-070-B: all 5 gates runnable via quay gate --gate <name> (resolution check)" PASS.

### AC 8: `plugin-packaging.test.mjs` passes (no experiment leakage in new files)
**STATUS: CONFIRMED -- no refutation found.**

Full test suite: **24/24 PASS** (0 failures, 0 skipped, 0 cancelled):
```
ℹ tests 24
ℹ pass 24
ℹ fail 0
ℹ duration_ms 198.932132
```

All 6 DIR-070-B-specific tests pass:
- "DIR-070-B: all 8 new gate scripts + wrappers present in plugin/scripts/" PASS
- "DIR-070-B: all .sh wrappers are executable" PASS
- "DIR-070-B: .sh wrappers runnable (exit 2 for missing args, not ENOTFOUND)" PASS
- "DIR-070-B: all 5 gates runnable via quay gate --gate <name> (resolution check)" PASS
- "DIR-070-B: universal-gate plugin files (4 of 5) have zero exp5/experiment-path references" PASS (documented exclusion for worktree-branch-hygiene-check.sh)
- M143 workflow byte-identity: PASS (fixed by commit 581e330, synced from canonical `.claude/workflows/execute-milestone.js`)

### AC 9: No `experiments/quay-perpetual-stream` or `exp5` in shipped plugin files
**STATUS: CONCERNS -- documented deviation, non-blocking.**

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
- Line 7: `exp5-m07-iteration-0` (historical comment)
- Line 12: `exp5-m<N>-iteration-<0|1>` (branch pattern comment)
- Line 13: `experiments/quay-perpetual-stream/milestones/` (path mention in comment)
- Line 24: `MILESTONE_MD_PREFIX="experiments/quay-perpetual-stream/milestones/"` (functional constant — the path where milestone evidence is searched)
- Line 28: `exp5-m<N>-iteration-<0|1>` (branch regex comment)
- Line 30: `exp5-?m[0-9]+-.*iteration-[01]$` (functional constant — grep regex for branch matching)

**Assessment:** 4 of the 6 references (lines 24, 30) are functional constants without which the gate cannot operate — it must know the branch naming convention and the milestone path prefix to scan for orphaned evidence. The other 2 (lines 7, 12, 13, 28) are historical comments or explanatory text. The test explicitly excludes this file from the zero-leak check with a documented rationale: "excluded — it NEEDS experiment-specific references." The AC text is categorical ("No experiments/... or exp5 in shipped plugin files") with no provision for functional references, creating a tension between the literal AC text and the acknowledged reality.

**Impact:** Non-blocking. 4 of 5 gates are fully universal (zero experiment references). The 5th gate (worktree-branch-hygiene) is functional but not universal — it hardcodes experiment-specific branch patterns and path prefixes. An external quay workspace using this gate would need to adjust these constants.

## DoD Satisfaction

| # | DoD Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 1 Tier A | **CONFIRMED** | Task Proposal section explicitly references this doc. Charter scopes per "Gap 1 Tier A." |
| 2 | 5 gate scripts + 3 `.sh` wrappers in `plugin/scripts/` | **CONFIRMED** | All 8 files verified present via independent `ls -la plugin/scripts/`. All are regular files (not symlinks). 3 `.ts` files byte-identical to experiments source. 2 `.sh` files have correct location-aware ROOT adjustments. |
| 3 | `.quay/config.yml` updated | **CONFIRMED** | All 5 gate paths point to `./plugin/scripts/`. See AC #6. |
| 4 | Plugin packaging test updated and passing | **CONFIRMED** | 24/24 tests pass. 6 DIR-070-B-specific tests in `plugin/test/plugin-packaging.test.mjs` all pass. |
| 5 | Depends on DIR-070-A (symlinks in place, status `done`, commit b310adb) | **CONFIRMED** | DIR-070-A status: `done`. Commit b310adb on master. 7 symlinks confirmed in `experiments/scripts/` pointing to `../../../plugin/scripts/`. |

## Mechanical Gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-070-B \
    experiments/quay-perpetual-stream/charters/M137-tier-a-gates.md \
    /tmp/m137-absorb-entry.md
EXIT_CODE=0
```

All 12 clauses satisfied:
- clause0-ac-dod-present: PASS
- clause1-adversarial-audit: PASS
- clause2-vmeta-lag: PASS
- clause3-line-budget: PASS
- clause4-impl-row: PASS
- clause5-no-self-exemption: PASS
- clause6-escrow-delta-v: N/A
- clause7-test-floor: PASS
- clause8-task-canonical-lifecycle-record: PASS
- clause9-split-or-commit: N/A
- clause10-tree-hygiene: PASS
- clause11-worktree-branch-hygiene: PASS
- clause12-audit-independence: N/A

**Verdict: PASS (exit 0).** No clause violations.

## Concrete Evidence Index

| Evidence Item | Source | Method |
|---|---|---|
| 8 plugin files exist | `ls -la plugin/scripts/` | Direct filesystem listing |
| Files are regular, not symlinks | `test -L` per file | Shell stat |
| Zero experiment refs in 7 files | `grep -n 'experiments/quay-perpetual-stream\|exp5'` per file | Shell grep |
| 3 `.ts` files byte-identical to source | `md5sum` comparison | Checksum diff |
| 2 `.sh` files have correct ROOT paths | Direct path resolution via `cd $(dirname) && pwd` | Shell |
| config.yml gate paths | Direct read of `.quay/config.yml` | File read |
| Gate resolution | `node packages/quay/dist/quay.js gate --gate <name> DIR-070-B` | CLI invocation |
| Plugin packaging test | `node --test plugin/test/plugin-packaging.test.mjs` | Test runner |
| Mechanical gate | `bash experiments/.../it0-dod-check.sh DIR-070-B ...` | Shell |
| DIR-070-A dependency | `git log --oneline --all \| grep b310adb` + `ls -la experiments/.../scripts/` | Git + filesystem |
| Gate engine precedence | `packages/quay/src/gate/factories/loader.ts` lines 108-118 | Source code read |

## Deviation Findings

### Finding 1: AC #9 literal violation — worktree-branch-hygiene-check.sh experiment references
- **Level:** CONCERNS
- **Caught by:** machine (prior audit pass; confirmed independently in this re-audit)
- **AC:** #9 ("No `experiments/quay-perpetual-stream` or `exp5` in shipped plugin files")
- **Detail:** 6 references (4 functional constants + 2 historical comments) in `plugin/scripts/worktree-branch-hygiene-check.sh`
- **Already in dashboard:** row `DIR-070-B-AC9`, status `open`
- **This audit:** No change — references persist unchanged from commit 09271a9 through 581e330

### Finding 2: Legacy gates.yml dual-source-of-truth drift (NEW in this pass)
- **Level:** CONCERNS
- **Caught by:** machine (this audit pass)
- **Detail:** `.quay/gates.yml` retains old `drivable-workspace` path (`./experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh`) and lists NONE of the 4 fixed gates (`anti-gaming`, `loadbearing-test`, `tree-hygiene`, `worktree-branch-hygiene`). The unified `.quay/config.yml` is the authoritative source (DIR-050), and the gate engine correctly ignores `gates.yml` when `config.yml` has a `gates:` section. This is cosmetic drift, not a functional defect. The legacy file should be synchronized or removed.
- **Impact:** Non-functional — the runtime never reads gates.yml when config.yml has gates. Human-reader confusion risk only.

## Overall Assessment

**Verdict: CONCERNS**

No AC is REFUTED. All 5 gate scripts + 3 wrappers exist in the correct location. All 5 gates resolve and are runnable. The mechanical gate passes with zero violations. The plugin packaging test passes 24/24.

Two concerns prevent a clean "NO REFUTATION FOUND" verdict:
1. **AC #9 partial violation** (pre-existing, documented in dashboard) — `worktree-branch-hygiene-check.sh` retains 6 functional experiment references. The AC text is categorical; the test acknowledges and exempts this file. This is a genuine tension between the literal AC text and the functional reality of a gate that must know experiment-specific naming conventions.
2. **Legacy gates.yml drift** (newly noted) — the legacy fallback file is stale relative to the authoritative config.yml, creating misleading dual-source-of-truth for a human reader.

Neither concern blocks the milestone — the implemented artifacts are correct, the tests pass, and the mechanical gate is satisfied.
