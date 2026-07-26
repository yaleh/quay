# M171 Iteration 0 — Prove classifier operative on real tasks (DIR-062-C)

**Charter:** [M171-dir062-c-classifier-operative.md](../../experiments/quay-perpetual-stream/charters/M171-dir062-c-classifier-operative.md)
**Task:** DIR-062-C
**Date:** 2026-07-26

## Done-when completion

### 1. Classifier produces correct verdicts on 3 real cases

Classification evidence collected from the wired `select-preflight.ts` `classifyCandidate()` function
(which calls `human-steered-classify.ts`'s `classify()` pure function inline, no subprocess):

| Case | Task | Touches | humanSteered | Triggering Clause |
|---|---|---|---|---|
| Driver-edit | DIR-072 | `experiments/quay-perpetual-stream/OUTER-LOOP.md` | `true` | `driverFileEdit` |
| Non-driver | DIR-073 | `.claude/workflows/execute-milestone.js`, scripts/ | `false` | (none — autonomous-eligible) |
| Cross-workspace | CLI test | `--workspace /opt/some-other-place` | `true` | `unauthorizedWorkspace` |

All three verdicts match expected per DIR-062's 3-clause definition. Additional verified:
DIR-070-E (touches `.claude/skills/quay-task-to-plan/`) → `humanSteered: true` (`driverFileEdit`).

### 2. select-preflight.ts invokes human-steered-classify.ts instead of only checking label:human-steered

- Removed the `label:human-steered` string-match pre-filter from `getCandidates()`.
- Added `extractTouchedFiles()` function to parse the `## Touches` section from task bodies.
- Added `classifyCandidate()` function that calls `classify()` from `human-steered-classify.ts`.
- Added `classifyCandidate` step to `buildPreflightResult()` which loads the drivable-workspaces registry,
  classifies each candidate, and filters out `humanSteered === true` from the result.
- Added `humanSteered` and `classifyDetail` fields to `CandidateEntry` for visibility.
- Added 6 selftest cases covering: driver-edit, non-driver, mission-redirection, unauthorized-workspace,
  covered-workspaces, skill-edit.

### 3. select-preflight.js (compiled/derived from .ts) reflects the classifier call

- Updated meta description to note DIR-062-C classifier integration.
- Updated agent prompt (TASK 1) to document that `select-preflight.ts` now handles human-steered
  classification mechanically (no LLM judgment needed for that step).

### 4. Existing select-preflight self-tests stay green

All 25 selftest cases (19 original + 6 new) pass:
```
SELFTEST: all fixture cases PASS
```

### 5. All driver selfchecks + fixtures stay green

- `human-steered-classify.ts --selftest`: 8/8 PASS
- `select-preflight.ts --selftest`: 25/25 PASS
- `drivable-workspace-check.ts --selftest`: 13/13 PASS

## DoD gate

`it0-dod-check.sh` run against charter + absorb-entry: **PASS — all 12 clauses satisfied, no undeclared self-exemption.**

## Files changed

- `experiments/quay-perpetual-stream/scripts/select-preflight.ts` — wired `classify()` from `human-steered-classify.ts`; removed `label:human-steered` string-match; added `extractTouchedFiles()`, `classifyCandidate()`; updated selftest with 6 new classifier integration cases.
- `.claude/workflows/select-preflight.js` — synced meta description and agent prompt to reflect mechanical classifier integration.
