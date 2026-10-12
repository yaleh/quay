---
id: gap-routine-freshness-refresh-stale-goal-009-ac-207
title: "freshness-refresh: AC-207's newest evidence (ts 2026-10-09T12:32:43Z,
  81.22h old, d=165) leaves margin/K=0.1750 below the 0.2223 threshold; the
  coldstart-face producer is its only "
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
AC-207's newest evidence (ts 2026-10-09T12:32:43Z, 81.22h old, d=165) leaves margin/K=0.1750 below the 0.2223 threshold; the coldstart-face producer is its only owner and last ran 2026-10-09.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1791841139196` · ts `2026-10-12T21:38:59.196Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-207`、`coldstart-face`
- 涉及文件：
- `.quay/goal-freshness-margin.json`
- `plugin/freshness-producers.json`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on hosts B+C from this host, passing --driving-profiles with a model name the TARGET host's gateway accepts

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-207`（routine `freshness-refresh`，runId `freshness-refresh-1791841139196`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-207.md`