# M152 iteration-0 — Extract shared gate-script framework (DIR-091)

**Milestone:** M152
**Task:** DIR-091
**Charter:** experiments/quay-perpetual-stream/charters/M152-dir091-gate-script-framework.md
**Date:** 2026-07-25

## Summary

Created `gate-script-lib.sh` (shell) and `gate-script-base.ts` (TS) providing shared primitives for gate check and selfcheck scripts. Refactored 8 existing scripts (5 thin wrappers + 3 selfchecks) to use the framework, reducing 222 lines of duplicated boilerplate.

## Done-when verification

1. **`gate-script-lib.sh` and `gate-script-base.ts` exist with shared primitives.** DONE.
   - `gate-script-lib.sh` (137 lines): `gate_delegate_ts`, `gate_run_selfcheck`, `gate_read_yaml_field`, `gate_emit_pass`, `gate_emit_fail`
   - `gate-script-base.ts` (127 lines): `parseArgs`, `readFrontmatter`, `emitPass`, `emitFail`, `requireArg`, `isDirectEntry`

2. **At least 5 check scripts refactored to use the framework.** DONE — 8 scripts refactored:
   - Thin wrappers: `task-schema-check.sh`, `vmeta-lag-check.sh`, `it0-dod-check.sh`, `audit-independence-check.sh`, `loadbearing-test-gate.sh`
   - Selfchecks: `task-schema-selfcheck.sh`, `vmeta-lag-selfcheck.sh`, `audit-independence-selfcheck.sh`

3. **All refactored scripts pass their selfchecks.** DONE — verified:
   - `task-schema-selfcheck.sh`: 14/14 PASS
   - `vmeta-lag-selfcheck.sh`: 8/8 PASS
   - `audit-independence-selfcheck.sh`: 7/7 PASS
   - `dod-fixture-selfcheck.sh` (depends on refactored `it0-dod-check.sh`): 17/17 PASS

4. **Line-count reduction >=200 total.** DONE — 222 lines reduced across refactored scripts (315 deleted, 93 inserted, net -222).

## Files changed

| File | Change |
|------|--------|
| `scripts/gate-script-lib.sh` | NEW — 137 lines |
| `scripts/gate-script-base.ts` | NEW — 127 lines |
| `scripts/task-schema-check.sh` | 26 → 8 lines (-18) |
| `scripts/vmeta-lag-check.sh` | 29 → 8 lines (-21) |
| `scripts/it0-dod-check.sh` | 32 → 8 lines (-24) |
| `scripts/audit-independence-check.sh` | 35 → 11 lines (-24) |
| `scripts/loadbearing-test-gate.sh` | 31 → 11 lines (-20) |
| `scripts/task-schema-selfcheck.sh` | 69 → 32 lines (-37) |
| `scripts/vmeta-lag-selfcheck.sh` | 61 → 25 lines (-36) |
| `scripts/audit-independence-selfcheck.sh` | 68 → 26 lines (-42) |

**Total reduction across refactored scripts: 222 lines**

## Framework primitives

### gate-script-lib.sh
- `gate_delegate_ts` — validate args + node, exec TS script (replaces shell process)
- `gate_run_selfcheck` — run fixture-based selfcheck loop against a check command; supports 3-field and 4-field CASES formats
- `gate_read_yaml_field` — read a YAML frontmatter field value from a markdown file
- `gate_emit_pass` / `gate_emit_fail` — standardized PASS/FAIL output

### gate-script-base.ts
- `parseArgs(argv, spec)` — standard CLI argument parsing with flag support
- `readFrontmatter(filePath)` — YAML frontmatter reading
- `emitPass(message)` / `emitFail(message)` — standardized PASS/FAIL output
- `requireArg(value, name)` — argument validation
- `isDirectEntry(importMeta)` — standard isDirect check for CLI scripts
