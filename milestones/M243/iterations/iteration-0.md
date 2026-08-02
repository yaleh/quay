# M243 iteration-0 report

- **Task:** DIR-124-A2
- **Charter:** experiments/quay-perpetual-stream/charters/M243-dir-124-a2.md
- **Plan:** docs/plans/M243-dir-124-a2.md
- **Date:** 2026-08-01
- **Outcome:** done (all AC satisfied)

## Summary

Built golden replay corpus: 10 fixtures (8 named operational cases + 2 known-defect shapes) plus 2 GREEN negative controls, with per-assertion classification, a replay runner, and a full test harness.

## Deliverables

1. **workflow-event-schema.mjs** — canonical stage-event schema v1 (needed by A2 runner; A1's scope)
   - `experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs`
   - `plugin/scripts/workflow-event-schema.mjs` (mirror)

2. **workflow-replay.ts** — pure-function golden replay runner
   - `experiments/quay-perpetual-stream/scripts/workflow-replay.ts`
   - `plugin/scripts/workflow-replay.ts` (canonical copy)

3. **12 fixture directories** under `fixtures/workflow-replay/`:
   - 8 main cases: legacy-singleton-success, composite-success, cache-resume, verify-failure, prepared-failure, audit-refuted, gate-failure, concurrent-partial-survivor
   - 2 defect fixtures: m192-null-build, m195-stale-prepared
   - 2 GREEN negative controls: legacy-singleton-success-tampered, m192-defect-as-normative

4. **workflow-replay.test.mjs** — 27 test cases covering AC1-AC12
   - `plugin/test/workflow-replay.test.mjs` (canonical copy, discoverable by scripts/test.sh)
   - `experiments/quay-perpetual-stream/test/workflow-replay.test.mjs` (mirror)

5. **absorb-entry.md** — added `## Backlog row` with `surface:method-infra,cross-cutting,docs`
   - `milestones/M243/absorb-entry.md`

## AC coverage

| AC | Status | Evidence |
|----|--------|----------|
| AC1 (fixture coverage + classification) | PASS | 8 main cases all pass; per-assertion 3-label classification validated |
| AC2 (known-defect shapes) | PASS | M192 (5 known-defect assertions with observed-but-undesired) + M195 (5 known-defect assertions with compatibility-only) |
| AC3 (baseline invariance) | PASS | 5-dimension deepEqual against meta.baseline in legacy-singleton-success |
| AC4 (RED/GREEN negative controls) | PASS | RED: tampered-normative fails; GREEN: defect-as-normative rejected by validator |
| AC5 (finer taxonomy) | PASS | internalCategory validated on all known-defect assertions |
| AC6 (schema validation) | PASS | Malformed events.jsonl and wrong schemaVersion both rejected at load time |
| AC7 (pure-function determinism) | PASS | Two calls return identical results; no agent/execFile/writeFileSync/appendFileSync in runner |
| AC8 (mirror byte-identity) | PASS | All 12 fixture dirs + schema + runner byte-identical between experiments/ and plugin/ |
| AC9 (non-goals) | PASS | No Wiring Audit, lifecycle policy, worktree redesign, stage scheduler, or resource lease introduced |
| AC10 (M192 code verification) | PASS | M192 fixture encodes null Build passthrough (4+ known-defect assertions) |
| AC11 (M195 code verification) | PASS | M195 fixture encodes Verify-before-Prepared ordering (4+ compatibility-only known-defect assertions) |
| AC12 (cache-resume verification) | PASS | cache-resume fixture has cache-hit waitReason on verify event |

## Test results

```
27 tests, 12 suites, 27 pass, 0 fail
```
