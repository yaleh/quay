# M147 iteration-0 — DIR-092 concurrent execution restore

**Date:** 2026-07-25
**Milestone:** M147
**Task:** DIR-092
**Charter:** experiments/quay-perpetual-stream/charters/M147-dir092-concurrent-fix.md
**Iteration:** 0 (class-routed development)

## Outcome

Done. Restored concurrent execution at the correct architectural layer: main session dispatches N workflows with `run_in_background: true`, each workflow does inline Build.

## Changes

### 1. PRE-FLIGHT: extra.acceptance set on DIR-092

`task_write` set `extra.acceptance` = "bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-092 ..."

### 2. IS_CONCURRENT guard — verified present in execute-milestone.js

The guard at `.claude/workflows/execute-milestone.js:168` was already present (survived the M135-M137 loop fixes). No change needed:
- `const IS_CONCURRENT = args.mode === 'concurrent'` (line 168)
- Concurrent path (lines 171-212): defers counter + dashboard, returns `{touchedFiles, dashboardEntry}`
- Serial path (lines 214-253): inline counter++ + dashboard — unchanged
- Build phase (lines 52-86): inline execution, no background dispatch — loop's fix preserved

### 3. Batch assembly restored in OUTER-LOOP.md

Added `batch_assemble` function (lines 58-67) and integrated into `select` pipeline (line 21):
- `select` return type changed from `Task` to `Candidate[]` (batch of 1..N)
- Pipeline: `... → rank → batch_assemble(charters) → writeback(batch, deferred, ...) → ∀c∈batch: author_ac_dod → ...`
- `batch_assemble` runs `concurrent-batch-scheduler.ts` on ranked shortlist
- Learning-type always serial; 1-wide fallback to serial path; touches-shared-state deferred
- Writeback: batch members get `milestone:M-NN` label; deferred get `## Not selected` note

### 4. Concurrent path (4b) restored in OUTER-LOOP.md

Added `concurrent_execute` function (lines 81-100):
- Dispatches N workflows with `run_in_background: true` from MAIN session (architectural fix per DIR-092)
- Waits for all N; collects survivors; runs `anti-drift-touches-check.ts` (NON-WAIVABLE)
- `serial-fanin-absorb.ts` for deterministic merge plan; merges in plan order
- Updates `milestone_counter += |survivors|`; dashboard append; regenerates views
- `execute` function now has `where |batch|=1` guard for serial path

## Done-when verification

1. IS_CONCURRENT guard restored. Build stays inline. -- CONFIRMED (already present, verified)
2. OUTER-LOOP step 1 batch assembly restored. -- DONE
3. OUTER-LOOP step 4b concurrent dispatch + fan-in restored. -- DONE
4. Serial path (1-wide) unchanged. -- CONFIRMED (execute where |batch|=1, unchanged logic)

## Files changed

- `experiments/quay-perpetual-stream/OUTER-LOOP.md` — restored batch_assemble + concurrent_execute functions; updated select pipeline for batch semantics
- `tasks/DIR-092.md` — extra.acceptance set

## Contracts

- C1 (execute-milestone.js exists): unchanged by this milestone
- C7 (all scripts resolve): all 16 referenced scripts exist on disk
- Gate hash: charter's GATE-HASH-REF unchanged
