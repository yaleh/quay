---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-232
title: "freshness-refresh: Same coldstart-face run as AC-203/207 (d=173, margin
  27); filing it is required because refreshing that run does not happen by
  itself."
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
Same coldstart-face run as AC-203/207 (d=173, margin 27); filing it is required because refreshing that run does not happen by itself.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792489168017` · ts `2026-10-20T09:39:28.017Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`GOAL-009-AC-232`
- 涉及文件：
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl`
- `plugin/freshness-producers.json:148`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on this host against hosts B and C (both ssh-authorized, reachability rc=0) supplying a target-recognized --driving-profiles

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `freshness-goal-009-ac-232`（routine `freshness-refresh`，runId `freshness-refresh-1792489168017`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-232.md`