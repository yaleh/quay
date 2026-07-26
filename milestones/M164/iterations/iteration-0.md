# M164 iteration-0 — Build Report

**Task:** DIR-098
**Charter:** experiments/quay-perpetual-stream/charters/M164-dir098-quay-init.md
**Date:** 2026-07-26

## Summary

Implemented `quay init` — workspace scaffolding command that generates a fully-documented `.quay/config.yml` and `tasks/` directory. Works identically in both Core CLI (`quay init`) and native CLI (`quay-native init`).

## Changes

### New files

| File | Purpose |
|---|---|
| `packages/quay/src/init.ts` | Shared init module — generates config YAML with all 3 sections (providers, gates, loop) + inline docs, auto-detects project type, handles --force/--dry-run/--root flags, creates tasks/ dir |
| `packages/quay/test/init.test.mjs` | 17 tests covering AC1-AC8, AC10 (both CLI surfaces), and edge cases. 95.65% line coverage on init.ts |

### Modified files

| File | Change |
|---|---|
| `packages/quay/bin/quay.ts` | Added `init` subcommand handler + import. Updated `printHelp()` with `init` section. Updated usage fallback to include `init`. |
| `packages/quay-native/bin/quay-native.ts` | Added `init` subcommand handler + import. Updated usage fallback to include `init`. |
| `packages/quay/package.json` | Added `"./init"` export for shared module consumption by quay-native. |
| `README.md` | Added "Creating a workspace" section documenting `quay init`. |
| `packages/quay-native/examples/sample-workspace/README.md` | Added pointer to prefer `quay init` over manual config creation. |

## Test Results

```
tests 17
pass 17
fail 0
init.ts coverage: 95.65% line, 69.23% branch, 100% functions
```

Combined test run (init + cli + config + gate): 44 tests, 0 failures. No regressions.

## Done-when Verification

| # | Clause | Status |
|---|---|---|
| 1 | `quay init` creates valid .quay/config.yml + tasks/ dir | PASS |
| 2 | `quay-native init` works identically | PASS |
| 3 | --force, --dry-run, --root flags functional | PASS |
| 4 | Tests >=80% coverage, RED->GREEN per ADR-001 | PASS (95.65%) |
| 5 | README updated | PASS |

## Acceptance Criteria Verification

| AC | Description | Status |
|---|---|---|
| AC1 | `quay init` at Node.js project creates config + tasks dir | PASS |
| AC2 | `quay init` at Go project creates Go-appropriate gate suggestions | PASS |
| AC3 | Refuses overwrite without --force | PASS |
| AC4 | --dry-run prints to stdout, no disk writes | PASS |
| AC5 | --root scaffolds at specified path | PASS |
| AC6 | Generated config is valid -- `quay task list` works | PASS |
| AC7 | Inline comments document every supported field | PASS |
| AC8 | `quay init --help` prints usage with all flags | PASS |
| AC9 | test/init.test.mjs with RED->GREEN pairs | PASS |
| AC10 | `quay-native init` works identically | PASS |
