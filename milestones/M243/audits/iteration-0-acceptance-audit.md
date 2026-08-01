# DIR-124-A2 (M243) Adversarial Acceptance Audit — Iteration 0

**Audit session id:** 8e4b1f78-9125-44bb-ae80-18db4a1fa534

**Verdict:** REFUTED

**Date:** 2026-08-01

**Worktree:** `milestones/M243/worktrees/iteration-0` (branch `milestone/M243/iteration-0`, commit `d1b63d2f`)

## Summary

The build delivers a golden replay corpus with a runner (`plugin/scripts/workflow-replay.ts`, 345 lines), an A1 v1 event schema module (`plugin/scripts/workflow-event-schema.mjs`, 110 lines), 10 fixture directories (8 named cases + 2 known-defect shapes), 2 negative-control fixtures, a 221-line test file (`plugin/test/workflow-replay.test.mjs`), and byte-identical mirror copies. The test suite has 27 test cases covering AC1-AC12. **12 tests fail** due to three distinct defects, and the mechanical gate (`it0-dod-check.sh`) independently fails with exit code 2.

## F1 — Predicate name mismatch: `fieldValueEquals` not defined in PREDICATES registry

**Severity: REFUTED (affects AC1, AC2)**

The runner defines a predicate `fieldEquals` (line 58 of `workflow-replay.ts`). Multiple fixture `expectations.json` files reference `fieldValueEquals`, which does not exist in the `PREDICATES` map. The validator at line 225 (`!PREDICATES[a.check.predicate]`) rejects the fixture, causing an `expectations-invalid` verdict.

Affected:
- `m192-null-build/expectations.json` assertion `m192-001` — predicate `fieldValueEquals`
- `concurrent-partial-survivor/expectations.json` assertion `cps-004` — predicate `fieldValueEquals`
- `m192-defect-as-normative/expectations.json` (negative control) — predicate `fieldValueEquals`

Direct re-run confirmation:
```
m192-null-build: verdict=expectations-invalid ok=false errors=1
  ERROR: assertion m192-001: unknown predicate "fieldValueEquals"
concurrent-partial-survivor: verdict=expectations-invalid ok=false errors=1
  ERROR: assertion cps-004: unknown predicate "fieldValueEquals"
```

## F2 — Predicate name mismatch: `stageEndsWithOutcome` not defined in PREDICATES registry

**Severity: REFUTED (affects AC1, AC2)**

`stageEndsWithOutcome` does not exist in the runner's `PREDICATES` map. The closest defined predicate is `outcomeMatches` (reads from terminal event) or `outcomePhaseEquals` (compares terminal event stage), but neither matches the `stageEndsWithOutcome` signature (which takes `stage`, `field`, `value` args and checks a specific non-terminal stage's outcome field).

Affected:
- `audit-refuted/expectations.json` assertion `ar-004` — predicate `stageEndsWithOutcome`
- `gate-failure/expectations.json` assertion `gf-005` — predicate `stageEndsWithOutcome`
- `m195-stale-prepared/expectations.json` assertion `m195-002` — predicate `stageEndsWithOutcome`

Direct re-run confirmation:
```
audit-refuted: verdict=expectations-invalid
  ERROR: assertion ar-004: unknown predicate "stageEndsWithOutcome"
gate-failure: verdict=expectations-invalid
  ERROR: assertion gf-005: unknown predicate "stageEndsWithOutcome"
m195-stale-prepared: verdict=expectations-invalid
  ERROR: assertion m195-002: unknown predicate "stageEndsWithOutcome"
```

## F3 — Missing `mappingNote` on `known-defect` assertions

**Severity: REFUTED (affects AC2, AC5)**

In `m195-stale-prepared/expectations.json`, assertions `m195-004` and `m195-005` have `classification: "known-defect"` but lack the required `mappingNote` field. The validator at line 222 (`if (!a.mappingNote) errors.push(...)`) rejects these. Note that `m195-004` and `m195-005` (classified `known-defect` with `internalCategory: "compatibility-only"`) describe "No Build after Prepared rejection" and "No Land after Prepared rejection" — these are actually `normative` invariants (fail-closed behavior), not `known-defect` observations. The classification label is wrong AND the `mappingNote` is missing.

Direct re-run confirmation:
```
m195-stale-prepared: verdict=expectations-invalid
  ERROR: assertion m195-004: known-defect requires mappingNote
  ERROR: assertion m195-005: known-defect requires mappingNote
```

## F4 — Mechanical gate failure (step 3)

**Severity: REFUTED (blocking by construction)**

`it0-dod-check.sh DIR-124-A2 experiments/quay-perpetual-stream/charters/M243-dir-124-a2.md milestones/M243/absorb-entry.md` exits with code 2.

Root cause: The absorb-entry `## Backlog row` line uses the format `surface:method-infra | DIR-124-A2 | M243 | ...` without a leading pipe. The checker filters for lines that `.startsWith("|")` (markdown table row format), so zero rows match and the check fails with `ERROR: "## Backlog row" section has no pipe-delimited row line`.

Expected format: `| surface:method-infra | DIR-124-A2 | M243 | golden replay corpus: 8 named cases + two known-defect shapes, per-assertion classification | 2026-08-01 |`

## F5 — Stage name case mismatch in m195-003

**Severity: CONCERNS (affects AC2)**

`m195-stale-prepared/expectations.json` assertion `m195-003` uses `"a": "Verify"` and `"b": "Prepared"` (capitalized) but the actual event stream uses lowercase stage names (`"verify"`, `"prepared"`). The `stageOrderedBefore` predicate performs case-sensitive comparison (`e.stage === a`). After F2's `stageEndsWithOutcome` fix, this case mismatch would cause `m195-003` to produce a false failure: both `findIndex` calls would return -1 for the capitalized stage names, returning "stage 'Verify' not found" instead of `true`.

This is a secondary issue — the `expectations-invalid` verdict from F2/F3 blocks loading the fixture before any assertion evaluation, so this defect is latent but real.

## Test suite result

27 tests total: 15 pass, 12 fail

**Passing (15):** init, legacy-singleton-success, `--all` covers 8 cases, AC4 RED, AC4 GREEN, AC5 m192 internalCategory check, AC6 malformed events, AC6 wrong schemaVersion, AC7 determinism, AC7 purity grep, AC8 schema mirror, AC8 runner mirror, AC8 fixtures mirror, AC10 m192, AC12 cache-resume

**Failing (12):** composite-success, cache-resume, verify-failure, prepared-failure, audit-refuted, gate-failure, concurrent-partial-survivor, m192-null-build, m195-stale-prepared, AC3 baseline invariance, AC5 m195 internalCategory, AC11 m195 code verification

Wait — composite-success, cache-resume, verify-failure, and prepared-failure reported as FAILING in the test suite but ALL PASSING when run directly. This discrepancy indicates a test-environment issue (likely the test's `FIXTURES_DIR` resolving to a different path than the direct invocation). However, the F1/F2/F3/F4 defects are independently confirmed via direct runner invocation and do not depend on this discrepancy.

## AC satisfaction matrix

| AC | Status | Evidence |
|----|--------|----------|
| AC1 (fixture coverage + classification) | **REFUTED** | F2: audit-refuted, gate-failure cannot be replayed (unknown predicate `stageEndsWithOutcome`). F1: concurrent-partial-survivor cannot be replayed (unknown predicate `fieldValueEquals`). 3 of 8 named fixtures fail to load. |
| AC2 (known-defect shapes) | **REFUTED** | F1: m192-null-build has unknown predicate `fieldValueEquals`. F2+F3: m195-stale-prepared has unknown predicate `stageEndsWithOutcome` AND missing `mappingNote` on two assertions. Neither defect fixture loads. |
| AC3 (baseline invariance) | **REFUTED** | Test failure (test AC3 fails — but this could be the environment discrepancy). The baseline fixture (legacy-singleton-success) itself replays correctly when run directly, producing the correct state vector. |
| AC4 (RED/GREEN negative controls) | PASS | RED control detects tampered normative assertion. GREEN control rejects defect-as-normative. Direct runner invocation confirms both. |
| AC5 (finer taxonomy) | **REFUTED** | F3: m195-004 and m195-005 lack required `mappingNote`. The internalCategory validation for m195 passes structurally (all are `compatibility-only`), but `mappingNote` is absent. |
| AC6 (schema validation) | PASS | Malformed events (wrong schemaVersion, missing fields) correctly rejected at load time. |
| AC7 (pure-function determinism) | PASS | Runner determinism confirmed (two identical calls produce identical results). grep audit confirms zero `agent(`, `execFile`, `writeFileSync`, `appendFileSync` in runner body. |
| AC8 (mirror byte-identity) | PASS | All three mirror parity checks pass: schema module, runner, and all 12 fixture directories byte-identical. |
| AC9 (non-goals) | PASS | File-list check shows only fixture/runner/test/sync-vendor files added. No Wiring Audit, lifecycle policy, worktree redesign, stage scheduler, or resource lease introduced. |
| AC10 (M192 code verification) | PASS | M192 fixture encodes null-Build passthrough behavior (4+ known-defect assertions present). |
| AC11 (M195 code verification) | **REFUTED** | Test failure — m195 fixture cannot be loaded due to F2/F3. F5 (case mismatch) also applies. |
| AC12 (cache-resume verification) | PASS | cache-resume fixture has cache-hit `waitReason` on verify event. |

## DoD satisfaction

| DoD Item | Status | Evidence |
|----------|--------|----------|
| Landed on `master` under human-steered discipline | NO | Not yet Landed (audit running in worktree). After Landing with fixes committed, this would be satisfied. |
| Golden replay runs green with RED/GREEN negative controls | **REFUTED** | 12 of 27 tests fail. RED/GREEN controls themselves pass, but the main fixture suite does not. |
| A fresh independent audit finds no refutation | **REFUTED** | This audit finds 5 distinct defects (F1-F5) refuting the build. |

## Root cause analysis

The predicate name mismatches (F1, F2) are a failure of mechanical consistency: the runner's `PREDICATES` map defines `fieldEquals`, `outcomeMatches`, and `outcomePhaseEquals`, but multiple fixture `expectations.json` files reference `fieldValueEquals` and `stageEndsWithOutcome`. These names were never reconciled against the actual predicate registry.

The `mappingNote` absences (F3) on assertions `m195-004` and `m195-005` are a validation failure: these two assertions are classified as `known-defect` with `internalCategory: "compatibility-only"`, but their actual semantic content ("No Build after Prepared rejection", "No Land after Prepared rejection") describes normative fail-closed behavior, not a known-defect observation. The classification is wrong AND the required `mappingNote` field is absent.

The mechanical gate failure (F4) is a format convention mismatch in the absorb-entry's `## Backlog row` line — it lacks the leading `|` expected by `it0-impl-row-check.sh`.

## Deviation log entries for dashboard.md

The following deviations are to be written to `experiments/quay-perpetual-stream/dashboard.md` in the worktree:

| caught-by | level | caught-at | description | status | age |
|-----------|-------|-----------|-------------|--------|-----|
| machine | REFUTED | M243 Audit | F1: `fieldValueEquals` predicate undefined in runner PREDICATES; fixtures m192-null-build, concurrent-partial-survivor fail with expectations-invalid | open | 0 |
| machine | REFUTED | M243 Audit | F2: `stageEndsWithOutcome` predicate undefined in runner PREDICATES; fixtures audit-refuted, gate-failure, m195-stale-prepared fail with expectations-invalid | open | 0 |
| machine | REFUTED | M243 Audit | F3: m195 assertions m195-004/m195-005 classified known-defect but missing mappingNote; validator rejects | open | 0 |
| machine | REFUTED | M243 Audit | F4: absorb-entry ## Backlog row missing leading pipe — it0-dod-check exits 2 | open | 0 |
| machine | CONCERNS | M243 Audit | F5: m195-003 stage names "Verify"/"Prepared" capitalized but event stream uses lowercase "verify"/"prepared" — case-sensitive predicate will produce false failure | open | 0 |
