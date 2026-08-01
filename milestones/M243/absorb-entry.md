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

surface:method-infra | DIR-124-A2 | M243 | golden replay corpus: 8 named cases + two known-defect shapes, per-assertion classification | 2026-08-01

## Gate

- Acceptance: PASS (golden replay runner + fixtures + RED/GREEN controls)

adversarial-audit disposition: REFUTED
V_meta consolidation-lag: PASS — no confirmed-unconsolidated row past K without a dated carry-forward (milestone_counter=205 K=2; both ledger rows [ok] consolidated / [ok] proposed, lag=- for both; domain-audit-channel≡CI-job already consolidated, repo-root isolation-leak lesson not past φ threshold)
