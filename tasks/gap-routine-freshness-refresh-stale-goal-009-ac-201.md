---
id: gap-routine-freshness-refresh-stale-goal-009-ac-201
title: "freshness-refresh: evidence_ts 2026-09-25T17:17:02Z is 321.87h old and
  the delivery-face distance d=217 already exceeds the window K=200 (margin -17)
  — the subject is outside the f"
status: todo
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
evidence_ts 2026-09-25T17:17:02Z is 321.87h old and the delivery-face distance d=217 already exceeds the window K=200 (margin -17) — the subject is outside the freshness window now, not merely approaching it

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1791515642323` · ts `2026-10-09T03:14:02.323Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`GOAL-009-AC-201`
- 涉及文件：
- `plugin/freshness-producers.json`
- `.quay/productization-verification.jsonl`
- `.quay/goal-freshness-margin.json`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on the verify hosts B and C with a target-gateway-known --driving-profiles

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-201`（routine `freshness-refresh`，runId `freshness-refresh-1791515642323`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-201.md`