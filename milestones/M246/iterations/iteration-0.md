# M246 iteration-0 — Build evidence

**Task:** DIR-124-A5 (Baseline metrics emission: mechanical/content split, explicit unknowns)
**Date:** 2026-08-01
**Worktree:** milestones/M246/worktrees/iteration-0 (branch milestone/M246/iteration-0)

## Deliverables

4 new files created (matching Touches declaration exactly):

1. `experiments/quay-perpetual-stream/scripts/workflow-baseline-metrics.ts` (new, ~1418 lines)
2. `plugin/scripts/workflow-baseline-metrics.ts` (new, byte-identical mirror of #1)
3. `experiments/quay-perpetual-stream/test/workflow-baseline-metrics.test.mjs` (new)
4. `plugin/test/workflow-baseline-metrics.test.mjs` (new, byte-identical mirror of #3)

## Verification evidence

### Tests
- **Experiments test file:** 68/68 PASS (0 fail, 0 skip)
- **Plugin test file:** 68/68 PASS (0 fail, 0 skip)
- **Script selftest (experiments):** all fixture cases PASS
- **Script selftest (plugin):** all fixture cases PASS
- **Full `scripts/test.sh` suite:** GREEN — only pre-existing split-or-commit violations (4x CHILD-LINK-SYMMETRY for DIR-124-A1a/A1b/A3a/A3b, pre-dating this milestone, not caused by these changes)

### Mirror byte-identity
- Script mirrors: IDENTICAL (diff exit 0)
- Test mirrors: IDENTICAL (diff exit 0)

### Read-only verification
- 0 mutation function calls (`writeFileSync`/`appendFileSync`/`mkdirSync`/`rmSync`/`cpSync`) in production code path
- All 8 mutation calls in selftest section only (temp fixture creation + cleanup)

### Structural checks
- Both mirrors: `--selftest` exits 0
- Script `--json` with absent event dir: exits 2 (usage/environment error), per AC10
- All 10 metric names present in report output
- Every measured metric carries `metricClass`
- Cross-child absent paths produce `"unknown"` for metrics 4 and 7
- `parseEventStream`: malformed JSONL skipped with parseWarning, valid lines still parsed
- Zero samples produces `{status: "no-data"}` with all metrics unknown

### AC coverage

| AC | Status | Evidence |
|---|---|---|
| AC1 (mechanical emission) | PASS | Tests verify all 10 metrics derived from structured event fields |
| AC2 (mechanical/content split) | PASS | classifyEvent rule-based, classifyMetric content-agent for metric 2 |
| AC3 (explicit unknowns) | PASS | Null fields → "unknown", not 0; verified by selftest RED fixtures |
| AC4 (before-state only) | PASS | No quality/score/recommendation fields in output schema |
| AC5 (zero samples valid) | PASS | {samples: 0, status: "no-data"} exit 0 |
| AC6 (read-only) | PASS | 0 mutation calls in production code |
| AC7 (non-goals) | PASS | Exactly 4 files touched, matching declaration |
| AC8 (cross-child) | PASS | A2/A3 present → populated; absent → "unknown" |
| AC9 (mirrors) | PASS | diff exit 0 for both script and test pairs |
| AC10 (exit codes) | PASS | Exit 0/1/2 verified; malformed line skipped with warning |
| AC12 (mechanical-runner sourcing) | PASS | Test fixture: all mechanical labels → mechanical-runner |
| AC13 (commandIdentity patterns) | PASS | All 10 patterns in classification table |
| AC14 (boundary-ambiguity) | PASS | commandIdentity script-match wins over agentLabel |
| AC15 (metricClass) | PASS | Every measured metric has metricClass |
| AC17 (script-path classification) | PASS | experiments/scripts/ prefix → mechanical-runner |

### AC not yet verifiable
- AC11 (gate-events-log): `.quay/gate-events.jsonl` characterization — structural claim, verified in separate audit
- AC16 (schema-module-mjs): A1 not yet landed — schema file does not exist, claim deferred

## A1 dependency status
- `workflow-event-schema.mjs` does NOT exist at the A1-specified path (A1 has not yet landed)
- `experiments/quay-perpetual-stream/.workflow-events/` does NOT exist (no real event data)
- Script produces `{samples: 0, status: "no-data"}` — honest empty baseline (AC5)
- All test fixtures are synthetic, matching A1 v1 schema shape per DD8

## Pre-existing issues (not caused by this build)
- 4 CHILD-LINK-SYMMETRY violations in split-or-commit check: DIR-124-A1a, DIR-124-A1b, DIR-124-A3a, DIR-124-A3b — fixed on master via task_write but branch's task store snapshot predates fix
