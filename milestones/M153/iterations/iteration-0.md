# M153 iteration-0 — SELECT preflight script + thin classify-deliverable workflow (DIR-072)

**Milestone:** M153
**Task:** DIR-072
**Charter:** experiments/quay-perpetual-stream/charters/M153-dir072-select-preflight.md
**Date:** 2026-07-25

## Summary

Encapsulated OUTER-LOOP SELECT preflight (steps 1-3) into a deterministic TypeScript script (`select-preflight.ts`) plus a thin workflow (`select-preflight.js`) with exactly ONE agent call for deliverable classification. Replaced ~15 manual turns per /loop wake-up with a single structured invocation.

## Done-when verification

1. **`select-preflight.ts` exists, outputs valid PreflightResult JSON, unit-tested.** DONE.
   - `experiments/quay-perpetual-stream/scripts/select-preflight.ts` (274 lines)
   - Pure functions: `checkHalt`, `getPendingDirectives`, `getCandidates`, `checkCandidateSchema`, `checkCandidateTouches`, `getCadence`, `getTaskList`, `buildPreflightResult`
   - CLI: `node --experimental-strip-types scripts/select-preflight.ts --json --workspace-root <path> --milestone-counter <n>`
   - 13 selftest fixture cases (halt detection, directive filtering, candidate extraction, touches check, edge cases) — all PASS
   - 21 Node test runner tests (`select-preflight.test.mjs`) — all PASS

2. **`select-preflight.js` exists with exactly ONE agent call (deliverable classification).** DONE.
   - `.claude/workflows/select-preflight.js` (105 lines)
   - Single `agent()` call that: runs preflight script → classifies deliverable (LLM judgment) → runs composeShortlist → returns complete result
   - Script execution and composeShortlist are shell commands within the same agent invocation (zero additional agent calls)

3. **OUTER-LOOP.md steps 1-3 rewritten to invoke `/select-preflight`.** DONE.
   - 7-line preflight invocation replacing 4 old lines (task_list → filter → compose_shortlist → rank)
   - New contracts C₈, C₉ added for workflow/script existence checks
   - All invariants preserved

4. **Existing selfchecks/fixtures stay green.** DONE — verified:
   - `select-preflight.ts` selftest: 13/13 PASS
   - `select-preflight.test.mjs`: 21/21 PASS
   - `deliverable-governor.test.mjs`: 14/14 PASS (unchanged)
   - `it0-split-or-commit-check.sh .`: PASS (417 tasks, no violations)
   - `tree-hygiene-check.sh`: PASS (clean)

## Files changed

| File | Change |
|------|--------|
| `experiments/quay-perpetual-stream/scripts/select-preflight.ts` | NEW — 274 lines |
| `experiments/quay-perpetual-stream/test/select-preflight.test.mjs` | NEW — 210 lines |
| `.claude/workflows/select-preflight.js` | NEW — 105 lines |
| `experiments/quay-perpetual-stream/scripts/deliverable-governor.ts` | +30 lines (added --shortlist CLI mode) |
| `experiments/quay-perpetual-stream/OUTER-LOOP.md` | edited (select function rewrite + C₈/C₉ contracts) |

## Implementation details

### select-preflight.ts
- **checkHalt:** reads `.halt` sentinel at workspace root; fail-closed (missing file → halt: false)
- **getPendingDirectives:** filters quay task list JSON to `label:directive` + `extra.dirStatus: pending`
- **getCandidates:** filters to `label:milestone-candidate` + `status: todo`, excludes `label:human-steered`
- **checkCandidateSchema:** reads task markdown file, calls `checkTask()` from `task-schema.ts`
- **checkCandidateTouches:** regex-checks for `## Touches` section in task body
- **getCadence:** shells out to `explore-exploit-cadence.ts --json`
- **getTaskList:** shells out to `quay task list --json` with 50MB maxBuffer
- **buildPreflightResult:** orchestrates all 7 operations, returns structured `PreflightResult` JSON

### deliverable-governor.ts --shortlist
- New `--shortlist` CLI mode reads `{candidates, streak, sMax}` from stdin, calls `composeShortlist()`, outputs `ShortlistResult` JSON
- Used by the select-preflight workflow after deliverable classification

### select-preflight.js workflow
- Single phase with ONE `agent()` call
- Agent performs 4 sequential tasks: run preflight script → classify deliverable (LLM judgment using criterion 丙) → compose shortlist → return result
- Criterion 丙: YES iff landed output consumed OUTSIDE loop (shipped code, release pipeline, skill/ADR); NO for loop's own machinery; ambiguous → NO

### OUTER-LOOP.md rewrite
- `select` function now starts with `preflight = invoke(".claude/workflows/select-preflight.js", {workspaceRoot})`
- Delivers `{shortlist, cadence, deliverableStreak, starvation, candidates}` for step 2 consumption
- `batch_assemble`, `writeback`, `author_ac_dod`, schema/size/split-or-commit/line-budget checks unchanged

## PreflightResult (real workspace, milestone_counter=152)

```
halt=false, pendingDirectives=[], cadence=OK (streak=2)
7 candidates: DIR-070, DIR-072, DIR-073, DIR-088, exp5-M-CLI-UX, exp5-M-DIRTASK, exp5-M-DOCS
```
