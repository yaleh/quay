# M136 iteration-0 report

**Milestone:** M136  
**Task:** DIR-070-A — Dual-copy resolution (sync-vendor --check + symlinks)  
**Charter:** experiments/quay-perpetual-stream/charters/M136-dual-copy-resolution.md  
**Iteration:** 0  
**Outcome:** done  

## Done-when verification

1. `sync-vendor.sh --check` exits non-zero on drift, zero on identical/expected-different. **PASS** — Verified: zero drift detected exits 0; artificially introduced drift exits 1 with "DRIFT" report.
2. Plugin packaging test uses dynamic scanning (not hardcoded static lists). **PASS** — Added `M136 (DIR-070-A): sync-vendor.sh --check dynamic scanning` test; verifies all 7 concurrency scripts plus all other sync-vendor managed files dynamically via `sync-vendor.sh --check`.
3. 7 symlinks created: `experiments/scripts/<name>` → `../../../plugin/scripts/<name>`. **PASS** — All 7 files converted from real copies to symlinks.
4. `sync-vendor.sh` skips symlinks (`test -L` guard). **PASS** — All 7 symlinks skipped: "skipping symlink: <name>.ts" for each.
5. Group 2 files (task-schema) remain real files — not symlinked. **PASS** — task-schema.ts, task-schema-check.ts, task-schema-check.sh remain as real files (ls shows `-rw-` not `lrwx`).
6. Existing experiment selfcheck fixtures pass (symlink transparent). **PASS** — probe-spec-wiring.test.mjs: 8/8 pass; task-schema-selfcheck.sh: 14/14 pass; plugin-packaging.test.mjs: 18/19 pass (1 pre-existing M143 workflow sync failure, unrelated).

## Changes made

### plugin/scripts/sync-vendor.sh
- Added `--check` flag parsing and `CHECK_MODE` variable
- Added `cmp_or_report()` helper for drift detection
- All 5 sync sections (vendor dist, skills, task-schema, concurrency scripts, package.json) now support `--check` mode
- Added `test -L` guard before copying concurrency scripts: symlinks are skipped
- `--check` exits 0 when clean, non-zero on drift
- Task-schema files are flagged as "expected-diff" (attribution differences are tolerated)

### plugin/test/plugin-packaging.test.mjs
- Added dynamic scanning test: runs `sync-vendor.sh --check` and verifies exit 0, CLEAN report, and exactly 7 concurrency scripts
- Test verifies no hardcoded file lists are needed — the script dynamically determines what to scan

### experiments/quay-perpetual-stream/scripts/ (7 files)
- anti-drift-touches-check.ts → symlink to `../../../plugin/scripts/anti-drift-touches-check.ts`
- concurrent-batch-scheduler.ts → symlink to `../../../plugin/scripts/concurrent-batch-scheduler.ts`
- read-probe-spec.ts → symlink to `../../../plugin/scripts/read-probe-spec.ts`
- routine-file-gate.ts → symlink to `../../../plugin/scripts/routine-file-gate.ts`
- routine-scheduler.ts → symlink to `../../../plugin/scripts/routine-scheduler.ts`
- serial-fanin-absorb.ts → symlink to `../../../plugin/scripts/serial-fanin-absorb.ts`
- touches-orthogonality-check.ts → symlink to `../../../plugin/scripts/touches-orthogonality-check.ts`

## Test results

```
plugin-packaging.test.mjs: 18/19 pass (1 pre-existing M143 failure)
probe-spec-wiring.test.mjs: 8/8 pass
sync-vendor.sh --check: exits 0, CLEAN
sync-vendor.sh (normal): skips all 7 symlinks
```

## Value delivered

- **Drift detection**: `sync-vendor.sh --check` mechanically detects any divergence between experiments/scripts/ and plugin/scripts/ for the 10 managed files. Exits non-zero on unexpected drift, zero on clean state.
- **Symlink elimination**: 7 identical-copy files replaced with symlinks — plugin/scripts/ is now the SINGLE source of truth. Changes to these files automatically propagate (no copy step needed).
- **Symlink safety**: `test -L` guard prevents sync-vendor.sh from overwriting symlinks with copies.
- **Dynamic testing**: plugin-packaging test uses dynamic scanning via `--check` — no hardcoded file lists to maintain as files are added/removed.

This closes Gap 4 (dual-copy structural problem) from `docs/proposals/exp5-deliverable-improvements.md`, unblocking DIR-070-B/C/D.
