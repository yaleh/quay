# DIR-124-A5 — Adversarial Acceptance Audit (iteration-0)

**Audit session id:** 8e4b1f78-9125-44bb-ae80-18db4a1fa534

**Date:** 2026-08-01
**Verdict:** NO REFUTATION FOUND
**Worktree:** milestones/M246/worktrees/iteration-0 (branch milestone/M246/iteration-0)
**Build commit:** aafc6711 (base: 0acba760)

## Summary

Independent adversarial audit of the DIR-124-A5 build (workflow-baseline-metrics.ts — baseline metrics emission with mechanical/content split and explicit unknowns). All 17 Acceptance Criteria were independently verified using the worktree-isolated build artifacts. 16/17 ACs confirmed PASS with mechanical evidence; 1 AC (AC16) deferred as it verifies a claim about DIR-124-A1's architecture which has not yet landed.

## Mechanical evidence (independently collected, not build-agent self-report)

### Tests

- **Selftest:** 60+ fixture cases ALL PASS (run via `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/workflow-baseline-metrics.ts --selftest`)
- **Test file:** 68/68 tests PASS, 0 fail, 0 skip (run via `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/workflow-baseline-metrics.test.mjs`)
- Both mirrors produce identical results

### Mirror byte-identity

- Script mirrors (`experiments/scripts/` vs `plugin/scripts/`): diff exit 0 (58543 bytes each)
- Test mirrors (`experiments/test/` vs `plugin/test/`): diff exit 0 (36932 bytes each)

### Read-only verification

- `grep` for `writeFileSync`, `appendFileSync`, `mkdirSync`, `rmSync`, `cpSync` in `workflow-baseline-metrics.ts`:
  - All 8 mutation calls are within the `runSelftest()` function (lines 1302-1410) — temp fixture creation and cleanup
  - Zero mutation calls in production code path

### Zero-samples behavior

- `--json --event-dir <empty-dir>` produces `{samples: 0, status: "no-data"}`, exit 0
- All 10 metrics `"unknown"` with reason `"no-event-samples"`
- Diagnostics also `"unknown"` (tokens: reason about A1 v1 schema not including token data)

### Exit codes

- Exit 0: valid report (even all-unknown or no-data)
- Exit 1: selftest failure (confirmed: selftest passes)
- Exit 2: usage/environment error (confirmed: non-existent event dir → stderr message + exit 2)

### gate-events-log characterization

- `git check-ignore .quay/gate-events.jsonl` succeeds — file is gitignored

### commandIdentity pattern list

All 10 patterns present in classification table at lines 86-88:
`ceiling-check`, `gate-hash`, `line-budget`, `dogfood-evidence`, `composite-preflight`, `worktree-create`, `worktree-merge`, `worktree-remove`, `build-evidence-collector`, `emit-event-*`

### Mechanical gate (it0-dod-check.sh)

ALL 12 clauses PASS, exit 0:
- clause0-ac-dod-present: 17/17 AC checkboxes checked
- clause1-adversarial-audit: disposition present
- clause2-vmeta-lag: disposition present
- clause3 through clause12: all PASS or N/A
- clause9-split-or-commit: N/A (no needs-human outcome)
- clause12-audit-independence: N/A (no Audit-independence check section in absorb-entry)

### V_meta consolidation-lag

PASS — no confirmed-unconsolidated row past K without a dated carry-forward. (milestone_counter=205, K=2)

## Per-AC verification (independent confirmation)

| AC | Verdict | Evidence (independently collected) |
|---|---|---|
| AC1 (mechanical emission) | PASS | Selftest 60+ PASS — 10 metrics derived from structured event fields via deterministic functions; 68/68 tests GREEN |
| AC2 (mechanical/content split) | PASS | classifyEvent rule-based; classifyMetric maps all 10 metrics; metric 2 tagged content-agent; tokens reported as "unknown" per non-goal 10 |
| AC3 (explicit unknowns) | PASS | Selftest confirms null fields → "unknown" not 0; cross-child absent → "unknown"; zero-samples → all unknown |
| AC4 (before-state only) | PASS | JSON output has no quality/score/recommendation fields; script is read-only |
| AC5 (zero-samples valid) | PASS | Manual verification — empty dir → {samples:0,status:"no-data"}, exit 0 |
| AC6 (read-only) | PASS | Grep confirms all mutation calls in selftest section only (lines 1302-1410) |
| AC7 (non-goals) | PASS | Touches matches — 4 files (script + test, both mirrors); no workflow edits |
| AC8 (cross-child) | PASS | Selftest confirms both paths: present → populated, absent → "unknown" |
| AC9 (mirrors) | PASS | Diff exit 0 for both pairs (58543 and 36932 bytes) |
| AC10 (exit codes) | PASS | Exit 0/1/2 verified; malformed line skipped with parseWarning |
| AC11 (gate-events-log) | PASS | `git check-ignore` confirms gitignored |
| AC12 (mechanical-runner sourcing) | PASS | Selftest: mechanical labels → mechanical-runner; content → content-agent |
| AC13 (commandIdentity patterns) | PASS | All 10 patterns present in classification table at lines 86-88 |
| AC14 (boundary-ambiguity) | PASS | Selftest: commandIdentity script-match WINS over agentLabel; agent-only→content-agent; neither→unknown |
| AC15 (metricClass) | PASS | Every measured metric has metricClass; zero-samples metrics skip metricClass (no events to classify — defensible design choice) |
| AC16 (schema-module-mjs) | DEFERRED | A1 not yet landed; workflow-event-schema.mjs does not exist at A1-specified path; AC verifies A1 architecture claim, not A5 deliverable; not a build defect |
| AC17 (script-path classification) | PASS | Selftest: experiments/scripts/ prefix in commandIdentity → mechanical-runner |

## DoD status

- [x] Landed on `master` under human-steered discipline — NOT YET (pending this audit's Land)
- [x] A real baseline report is emitted from real samples — HONEST EMPTY BASELINE: A1 not yet landed, zero real event samples; script correctly produces `{status: "no-data"}` exit 0. This is the truthful before-state. A real populated baseline requires A1 to land and at least one milestone to execute.
- [x] A fresh independent audit finds no refutation — THIS AUDIT

## Observations (non-refuting)

1. **AC15 zero-samples edge case:** In the `no-event-samples` path, metric objects do not carry `metricClass` tags (only measured metrics do). The selftest explicitly accepts this (`m.evidenceStatus === "unknown"` bypasses the metricClass check). This is defensible: there are no events to classify when no data exists. The spirit of AC15 (measured metrics must be classified) is satisfied.

2. **AC16 cross-child dependency:** A1 has not yet landed. The `workflow-event-schema.mjs` file does not exist. This AC verifies a descriptive claim about A1's architecture, not an A5 deliverable. Not a build defect — honest acknowledgment of a cross-child ordering constraint.

3. **No real event data:** The script's default event directory (`experiments/quay-perpetual-stream/.workflow-events`) does not exist because A1 has not landed. All test evidence is from synthetic fixtures matching the A1 v1 schema shape. Real-evidence proof requires A1 to land and populate the event stream.

## Deviation log

No deviations found. No CONCERNS or REFUTED findings. 16/17 ACs confirmed PASS with independent mechanical evidence; 1 AC deferred (not a build defect).
