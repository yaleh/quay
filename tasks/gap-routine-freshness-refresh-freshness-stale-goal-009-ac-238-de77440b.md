---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238-de77440b
title: "freshness-refresh: Freshness window crossed (d=222, margin -22); newest
  AC-238 evidence is 209.4h old (2026-10-13T18:18:10Z, build d7381ed6) and the
  upgrade face has not run since,"
status: ready
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
Freshness window crossed (d=222, margin -22); newest AC-238 evidence is 209.4h old (2026-10-13T18:18:10Z, build d7381ed6) and the upgrade face has not run since, so the margin decays at ~9 commits/h into a 200-commit window.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792669460476` · ts `2026-10-22T11:44:20.476Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`verify_upgrade_mode`、`transport_evidence_append`、`check_upgrade_pairing`
- 涉及文件：
- `plugin/freshness-producers.json:176`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `.quay/productization-verification.jsonl:373`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Re-run upgrade-face on host B (ssh authorized rc=0 this round; 17G free on /; aged source /home/yale/work/meta-cc-aged-ac238-copy present) with a --driving-profiles whose worker-default.model the B gateway recognizes.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `GOAL-009-AC-238` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-22T11:44:20.476Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-238`（routine `freshness-refresh`，runId `freshness-refresh-1792669460476`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238-de77440b.md`