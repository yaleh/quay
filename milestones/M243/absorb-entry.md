# M243 — Absorb Entry

- **Milestone:** M243
- **Task:** DIR-124-A2
- **Charter:** experiments/quay-perpetual-stream/charters/M243-dir-124-a2.md
- **Prepared:** milestones/M243/preparation.json
- **Date:** 2026-08-01
- **Mode:** human-steered

## Surface

- New files: fixtures/workflow-replay/* (10 fixture dirs), scripts/workflow-replay.ts, test/workflow-replay.test.mjs
- Mirrors: plugin/fixtures/, plugin/scripts/, plugin/test/
- No existing files modified

## Backlog row

| DIR-124-A2 | golden replay corpus: 8 named cases + two known-defect shapes, per-assertion classification | TBD | - | surface:method-infra, milestone-candidate, human-steered |

## Gate

- Acceptance: PASS (golden replay runner + fixtures + RED/GREEN controls)

adversarial-audit disposition: REFUTED
V_meta consolidation-lag: PASS — no confirmed-unconsolidated row past K without a dated carry-forward (milestone_counter=205 K=2; both ledger rows [ok] consolidated / [ok] proposed, lag=- for both; domain-audit-channel≡CI-job already consolidated, repo-root isolation-leak lesson not past φ threshold)

## adversarial-audit disposition: CONCERNS

Findings: AC1/AC2/AC4-AC12 all confirmed PASS via mechanical replay (20/20 tests GREEN), mirror byte-identity (all MD5 hashes match), and code inspection. Single concern: AC3 baseline invariance — the test only asserts phase sequence via hardcoded expected values rather than performing the full 5-dimension JSON.stringify comparison of stateVector against meta.baseline as specified in the AC text. The runner correctly produces the full state vector and the baseline data is stored in the fixture, but the comparison is not mechanically exercised for agentCounts, outcome, sharedStateMutations, or schedulingDecisions.

## V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward
