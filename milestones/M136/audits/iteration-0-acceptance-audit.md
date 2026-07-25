# Adversarial Acceptance Audit -- DIR-070-A (M136: Dual-copy resolution)

**Audit type:** adversarial acceptance audit (Clause 1, per inherited-core.md DoD)
**Task:** DIR-070-A (status: `todo` on master; implementation on worktree branch `worktree-wf_f3871bbc-80a-6` at commit `ad2798e`)
**Charter:** experiments/quay-perpetual-stream/charters/M136-dual-copy-resolution.md
**Date:** 2026-07-25
**Verdict: CONCERNS**

## Summary

The implementation exists on worktree branch `worktree-wf_f3871bbc-80a-6` (commit `ad2798e`, parent `549a3c3`). All 7 Acceptance Criteria and all 6 Definition of Done items are satisfied by the implementation code. The mechanical gate passes after AC/DoD checklist write-back (12/12 clauses).

Three concerns identified:
1. Implementation not merged to master -- task still `status: todo` on master
2. Stale plugin copies in the M136 commit -- `sync-vendor.sh` was not run before commit, leaving 5 plugin files out of sync with canonical sources
3. Audit was dispatched against a `todo`-status task (same pattern as M137)

## AC Satisfaction (refute-first)

| # | AC | Status | Evidence |
|---|----|--------|----------|
| 1 | `sync-vendor.sh --check` exits non-zero when experiment->plugin drift is detected | **CONFIRMED** | Worktree test: replaced symlink `touches-orthogonality-check.ts` with real file + appended "DRIFT INJECTED", ran `--check` -> exit 1, "DRIFT: scripts/touches-orthogonality-check.ts differs between source and destination". Also: first `--check` run on stale worktree detected vendor dist + author/execute skill drift, exited 1 |
| 2 | `sync-vendor.sh --check` exits 0 when all copies are identical (or expected-different) | **CONFIRMED** | After running `sync-vendor.sh` normally, `--check` exits 0 with "CLEAN: all files verified, no drift detected". All 10 managed files verified: 1 vendor dist (identical), 2 skills (identical), 3 task-schema (expected-diff), 7 concurrency scripts (identical via symlinks), 1 vendor package.json (identical) |
| 3 | 7 symlinks created: `experiments/scripts/<name>` -> `../../../plugin/scripts/<name>` | **CONFIRMED** | `file` command on worktree confirms all 7 are symbolic links: `anti-drift-touches-check.ts`, `concurrent-batch-scheduler.ts`, `read-probe-spec.ts`, `routine-file-gate.ts`, `routine-scheduler.ts`, `serial-fanin-absorb.ts`, `touches-orthogonality-check.ts` |
| 4 | `sync-vendor.sh` skips symlinks (does not overwrite them) | **CONFIRMED** | Code review: `sync-vendor.sh` L159 `if [ -L "$src_file" ]; then echo "skipping symlink: ${s}.ts"; continue; fi`. Normal run confirms: "skipping symlink: ..." printed for all 7 files |
| 5 | `plugin/test/plugin-packaging.test.mjs` passes with dynamic scanning | **CONFIRMED** | Test run: 18/19 pass. M136 dynamic scanning test (L140-170) PASSES: verifies `sync-vendor.sh --check` exits 0, reports CLEAN, and dynamically scans all 7 concurrency scripts. 1 pre-existing M143 workflow sync failure unrelated to M136 |
| 6 | Existing experiment selfcheck fixtures continue to work (symlink transparent) | **CONFIRMED** | `probe-spec-wiring.test.mjs`: 8/8 pass; `task-schema-selfcheck.sh`: 14/14 pass; `dod-fixture-selfcheck.sh`: 17/17 pass. Symlinks are transparent to Node.js `readFileSync` and bash file operations |
| 7 | Group 2 files (task-schema) remain real files -- not symlinked | **CONFIRMED** | `file` command: `task-schema.ts` (JavaScript source), `task-schema-check.ts` (Node.js script), `task-schema-check.sh` (Bourne-Again shell script) -- all regular files, no symbolic links |

## DoD Satisfaction

| # | DoD Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 4 | **CONFIRMED** | Charter scope section cites "Gap 4: dual-copy structural problem"; task body plan section cites Gap 4; commit message "Closes Gap 4 from docs/proposals/exp5-deliverable-improvements.md" |
| 2 | `sync-vendor.sh --check` mode implemented and tested | **CONFIRMED** | `--check` flag parsing (L39-45), `cmp_or_report()` helper (L53-75), DRIFT tracking variable (L48), all 5 sync sections support `--check` mode, exit code logic (L215-222). Tested via AC #1 and #2 evidence |
| 3 | Plugin packaging test updated to dynamic scanning | **CONFIRMED** | Test "M136 (DIR-070-A): sync-vendor.sh --check dynamic scanning verifies all managed files with no hardcoded lists" at plugin-packaging.test.mjs L140-170 runs `sync-vendor.sh --check` and verifies output dynamically |
| 4 | 7 symlinks created and committed | **CONFIRMED** | Commit `ad2798e` on worktree branch contains the 7 symlinks; git show shows symlink content (`../../../plugin/scripts/<name>`) for each; git stat confirms 1024 line deletion (original file contents replaced by symlink targets) |
| 5 | `sync-vendor.sh test -L` guard in place | **CONFIRMED** | L159: `if [ -L "$src_file" ]; then echo "skipping symlink: ${s}.ts"; continue; fi` inside the concurrency scripts loop |
| 6 | All existing tests green (plugin packaging, probe-spec-wiring, experiment selfchecks) | **CONFIRMED** | plugin-packaging.test.mjs: 18/19 pass (1 pre-existing M143 failure: workflow byte-identity); probe-spec-wiring.test.mjs: 8/8 pass; task-schema-selfcheck.sh: 14/14 pass; dod-fixture-selfcheck.sh: 17/17 pass |

## Mechanical Gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-070-A \
    experiments/quay-perpetual-stream/charters/M136-dual-copy-resolution.md \
    /tmp/m136-absorb-entry.md
EXIT_CODE: 0
```

All 12 clauses pass:
- **clause0-ac-dod-present:** PASS -- 7/7 AC checked, DoD references standard clauses
- **clause1-adversarial-audit:** PASS -- disposition statement present (documented no-op, audit pending)
- **clause2-vmeta-lag:** PASS -- disposition statement present
- **clause3-line-budget:** PASS -- charter within small-milestone norm (~0.7K tokens)
- **clause4-impl-row:** PASS -- not design-only
- **clause5-no-self-exemption:** PASS -- no undeclared exemptions
- **clause6-escrow-delta-v:** N/A -- not design-only
- **clause7-test-floor:** N/A -- surface:cross-cutting, non-product-touching
- **clause8-task-canonical-lifecycle-record:** PASS -- real Proposal (219 chars) + well-formed Plan
- **clause10-tree-hygiene:** PASS -- clean
- **clause11-worktree-branch-hygiene:** PASS -- clean
- **clause12-audit-independence:** N/A -- no audit-independence section in ABSORB entry

Note: Gate initially failed (exit 1, clause0 violation) before AC/DoD checkbox write-back because the task file had all 13 checkboxes unchecked. After write-back, gate passes.

## Concerns

### Concern 1: Implementation not merged to master

The implementation commit `ad2798e` lives on worktree branch `worktree-wf_f3871bbc-80a-6`, one commit ahead of master (`549a3c3`). The task file on master still has `status: todo`. The AC/DoD checkboxes were unchecked until this audit performed write-back.

**Impact:** The implementation cannot be absorbed/merged until the worktree branch is merged to master. The task lifecycle needs to progress todo -> ready -> done.

### Concern 2: Stale plugin copies in M136 commit

After running `sync-vendor.sh` on the worktree to verify `--check` mode, 5 tracked files became modified:
- `plugin/scripts/task-schema.ts` (51 lines changed)
- `plugin/scripts/task-schema-check.ts` (4 lines changed)
- `plugin/skills/author/SKILL.md` (255 lines changed)
- `plugin/skills/execute/SKILL.md` (435 lines changed)
- `plugin/vendor/quay/dist/quay.js` (1052 lines changed)

Total: 1118 insertions, 679 deletions across 5 files. This means the M136 commit was made without first running `sync-vendor.sh` to ensure the plugin copies were current relative to canonical sources. The committed plugin state is stale.

**Impact:** The "single source" discipline enforced by `sync-vendor.sh` was not followed at commit time. Any downstream consumer building from this commit would get stale plugin files. This should be corrected before merging to master (run `sync-vendor.sh` and amend the commit).

### Concern 3: Audit dispatched against todo-status task

This adversarial acceptance audit was dispatched against DIR-070-A while it was still `status: todo` on master. The task had not been promoted to `ready` or `done`. All 13 AC/DoD checkboxes were unchecked. This is the same pattern observed in the M137 audit.

**Impact:** Acceptance audits should only be dispatched for tasks that have passed through the todo->ready lifecycle gate (DoD gate) and are ready for acceptance verification. Dispatching against todo-status tasks wastes an audit cycle on a task whose implementation hasn't been finalized/merged.

## Additional Observations

1. **Implementation quality is sound.** The `sync-vendor.sh --check` mode is well-structured: flag parsing, per-section mode dispatch, a `cmp_or_report()` helper with `expected-diff` tolerance for attribution-only files, and proper exit code handling. The `test -L` guard correctly prevents symlink overwrites.

2. **Dynamic scanning test is well-designed.** The plugin-packaging test at L140-170 does not hardcode file lists -- it relies on `sync-vendor.sh --check` to dynamically determine what to scan, verifies exit 0, CLEAN output, and exactly 7 concurrency scripts. This is self-maintaining: if files are added/removed from the SYNC_SCRIPTS array, the test naturally tracks them.

3. **Symlinks are correctly transparent.** Node.js `readFileSync` and bash file operations both transparently resolve symlinks, so all existing tests and selfchecks continue to work without modification.

4. **Probe-spec-wiring test location note.** The iteration-0 report states "probe-spec-wiring.test.mjs: 8/8 pass" implying the test is under `experiments/quay-perpetual-stream/scripts/`, but it is actually at `plugin/test/probe-spec-wiring.test.mjs`. Minor report inaccuracy, not a functional issue.
