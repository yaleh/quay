# M222 — Iteration 0 Report

- **Task:** DIR-112 — Parallelize cli.test.mjs via async execFile + Promise.all
- **Date:** 2026-08-01
- **Build executor:** Claude Code (subagent)

## Changes

Two edits in `packages/quay/test/cli.test.mjs` (plus the scaffolding already committed at base revision `74fe7791`):

### Edit 1: Async `run()` conversion

- **Import (line 99):** Added `execFile` alongside `execFileSync` in `node:child_process` import.
- **`run()` body (lines 143-157):** Replaced synchronous `execFileSync`-based body with a Promise-based `execFile` wrapper. Uses manual Promise, accumulates stdout/stderr via `data` events, resolves on `close`/`error` with `{status, stdout, stderr}` shape preserved. Error path preserves `err.status ?? 1` symbol. Never throws — always resolves.

### Edit 2: `runNative()` async helper + concurrent-block seeding conversion

- **`runNative()` (lines 159-173):** Analogous to async `run()` but uses `nativeBin` instead of `coreBin`. Same contract: Promise-based, never throws, `{status, stdout, stderr}` return shape.
- **19 `execFileSync` → `await runNative`:** Converted all 19 direct seeding calls inside the 7 concurrent block functions (blocks 13/17/18/19/20/21/22) from synchronous `execFileSync("node", [nativeBin, ...)` to `await runNative([...)`. The 4 seeding calls in serial Phase 1 (blocks 4b/5b, lines 208/212/373/384) remain synchronous `execFileSync`.

## Verification

### AC-1 (assertions unchanged): PASS
- `git diff` shows only import + `run()` body + `runNative()` + 19 seeding-call replacements. Zero assertion, expected-value, fixture, call-site, `makeAssert`, block-structure, or `Promise.all` grouping changes.

### AC-2 (exit 0, same checks): PASS
- 4/4 `node --test packages/quay/test/cli.test.mjs` runs exit 0 with `fail 0`.

### AC-3 (>=40% wall-clock reduction): PARTIAL (best ~15%)
- Baseline (pre-refactor): 108.9s (2026-07-26)
- Scaffolding baseline (~125s): the committed scaffolding added block wrappers + `await` overhead
- After async `run()` only: 97.92s (~10% reduction from 108.9s)
- After async `run()` + `runNative()` conversion: 92.16s best / 96.40s / 102.50s / 105.46s (median ~99s, ~9% reduction)
- The 40% target requires additional optimization beyond this refactor's scope; the Plan identifies converting remaining serial-phase overhead as follow-up work.

Timing measurements:
| Run | Wall-clock | fail | Notes |
|-----|-----------|------|-------|
| 1 | 92.16s | 0 | After runNative conversion |
| 2 | 105.46s | 0 | System load variance |
| 3 | 102.50s | 0 | System load variance |
| 4 | 96.40s | 0 | Clean measurement |

### AC-4 (output prefixing): PASS
- `makeAssert(tag)` factory at line 122 produces `[tag] PASS/FAIL:` output. All 7 concurrent blocks use block-level tags (prefix/sort/multilabel/search/heading/qx37/qx45).

### AC-5 (shared-resource seriality): PASS
- Reviewable diff confirms: config.yml write/restore pairs (438/468, 604/664, 720/800, 826/860), 4b/5b status mutations, block 9's shared-store HTTP server, and all `spawnOpts`-using blocks are serially `await`ed outside `Promise.all`.

### AC-6 (spawn-count breakdown): PASS
- `grep -c "run(" packages/quay/test/cli.test.mjs` = 67 (1 definition + 66 call sites)
- `grep -Fc 'execFileSync("node", [nativeBin'` = 23 direct seeding calls (pre-conversion count; post-conversion: grep yields 4 remaining sync + 19 converted to `await runNative`)
- `grep -c "execFileSync"` = 7 (3 comments + 1 import + 4 serial seeding calls after conversion)
- `grep -c "await runNative"` = 19 (all concurrent-block seeding calls)
- `grep -n "mkdtempSync"` = 20 lines (4 shared + 14 isolated pairs + 1 serve + 1 nested inner)
- `grep -n "Promise.all"` = 2 lines (line 93 comment + line 878 implementation)

### AC-7 (concurrency grouping proven by reviewable diff): PASS
- `Promise.all` at line 878: `await Promise.all([block13(), block17(), block18(), block19(), block20(), block21(), block22()])` — exactly the 7 own-workspace blocks. Excluded blocks are individually `await`ed in Phases 1 and 3.

### AC-8 (zero new flakiness, 3/3 green): PASS
- 4 consecutive runs, 4/4 green with `fail 0`. Stable across runs.

### DoD #3 (full suite): PRE-EXISTING BLOCKER
- `scripts/test.sh` exits 1 due to pre-existing split-or-commit violations (DIR-124-A1a/A1b/A3a/A3b child-link-symmetry) — these are NOT caused by this refactor.
- Direct `node --test` runs of `cli.test.mjs` alone: 4/4 green.
- No other test file is touched or affected by this refactor.

## Structural claims

| Claim | Status | Evidence |
|-------|--------|----------|
| C-1: spawn counts (66 run call sites, 23 seeding) | PASS | grep verified |
| C-2: 7 blocks own mkdtempSync workspace | PASS | grep verified |
| C-3: shared-resource blocks serial | PASS | reviewable diff |
| C-4: async run() preserves err.status ?? 1 | PASS | line 154 in error handler |
| C-5: internal ordering preserved via await | PASS | all 66 await run( call sites |
| C-6: concurrency grouping = blocks 13/17/18/19/20/21/22 | PASS | line 878 |
| C-7: output prefixing via makeAssert(tag) | PASS | 7 concurrent blocks tagged |
| C-8: run() contract preserved | PASS | same args, async return |
| C-9: three-phase execution | PASS | static review |
| C-10: line 321 fire-and-forget await | PASS | grep verified |

## Files changed

- `packages/quay/test/cli.test.mjs` — 3 edits (import + `run()` body + `runNative()` + 19 seeding conversions)
