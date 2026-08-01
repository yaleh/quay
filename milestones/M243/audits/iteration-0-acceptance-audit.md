# DIR-124-A2 Adversarial Acceptance Audit (Iteration 0)

**Audit session id:** 8e4b1f78-9125-44bb-ae80-18db4a1fa534

**Audit date:** 2026-08-01

**Verdict: CONCERNS** — 11 of 12 acceptance criteria confirmed PASS; 1 genuine concern identified (AC3 baseline invariance: full 5-dimension JSON.stringify comparison not mechanically exercised in test).

## Methodology

This audit was conducted under DIR-123 worktree isolation at `milestones/M243/worktrees/iteration-0` (branch `milestone/M243/iteration-0`, commit `e768c6c5`). All artifacts were inspected from the worktree, tests were run from the worktree, and the mechanical gate was invoked from the worktree.

## Evidence Summary

### Test suite: 20/20 GREEN

```
node --experimental-strip-types --test plugin/test/workflow-replay.test.mjs
```
- 15 suites, 20 tests, 0 failures, 0 skipped
- All 8 named cases pass
- Both RED controls pass (m192-null-build, m195-stale-prepared)
- Both GREEN controls fail as expected
- Determinism test passes
- Schema validation tests pass

### Mirror parity: byte-identical

All 38 fixture files under `experiments/quay-perpetual-stream/fixtures/workflow-replay/` and `plugin/fixtures/workflow-replay/` match exactly (MD5 confirmed). Script symlinks point from experiments/ to plugin/ canonical copies.

### Purity: confirmed

`grep` for `agent(`, `execFile`, `writeFileSync`, `appendFileSync` in runner body returns zero hits.

## Per-AC Findings

### AC1 (fixture coverage + classification): PASS
All 8 named cases present as fixture directories. All 12 fixture directories contain valid `events.jsonl` + `expectations.json`. All assertions carry `classification` from the 3-label set. Runner validates classifications at load time. 20/20 tests GREEN.

### AC2 (known-defect shapes): PASS
`m192-null-build/` (4 known-defect) and `m195-stale-prepared/` (3 known-defect + 2 normative) correctly encode defect behavior. No normative assertion depends on defect predicates.

### AC3 (baseline invariance): CONCERNS
Runner correctly builds full 5-dimension state vector. Baseline data stored in expectations.json. Test only asserts phase sequence via hardcoded values, not full 5-dimension JSON.stringify comparison of stateVector against meta.baseline. Mechanism is structurally correct; test coverage is incomplete.

### AC4 (RED/GREEN negative controls): PASS
RED controls pass (exit 0, defect reproduced). GREEN controls fail correctly (tampered-normative: exit 1; defect-as-normative: exit 1).

### AC5 (finer taxonomy): PASS
All known-defect assertions have valid internalCategory + mappingNote. Validator rejects mismatches.

### AC6 (schema validation): PASS
Bad schema version + missing fields correctly rejected at load time.

### AC7 (pure-function determinism): PASS
Zero prohibited calls in runner. Two identical calls produce identical results.

### AC8 (mirror byte-identity): PASS
Byte-identical across mirrors (MD5). sync-vendor.sh extended.

### AC9 (non-goals): PASS
Only fixture/runner/test/sync-vendor files added. No Wiring Audit, lifecycle policy, worktree redesign, stage scheduler, or resource lease.

### AC10 (M192 code verification): PASS
M192 fixture encodes pre-M208 null-passthrough. RED control confirms defect reproduces.

### AC11 (M195 code verification): PASS
M195 fixture encodes pre-flip ordering. verifyBeforePrepared + preparedOutcomeEquals predicates pass.

### AC12 (cache-resume verification): PASS
Cache-resume fixture: 6 verify events with source:"cache" and waitReason:"cache-hit". Terminal outcome done.

## Mechanical Gate

```
it0-dod-check.sh DIR-124-A2 ... milestones/M243/absorb-entry.md
```
Result: 1 clause violation (clause0: AC3 unchecked). All other clauses PASS or N/A. Exit 1, consistent with CONCERNS verdict.

## Disposition

Adversarial-audit disposition: CONCERNS — appended to absorb-entry.md.
V_meta consolidation-lag: PASS — no confirmed-unconsolidated row past K.

## Deviation Log

No new defects found. AC3 concern is a test-coverage gap (mechanism correct, data present, full 5D comparison not exercised). No deviation row needed.
