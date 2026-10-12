---
id: gap-routine-freshness-refresh-stale-goal-009-ac-201-e398b211
title: "freshness-refresh: AC-201's newest carrier evidence (ts
  2026-10-09T13:18:40Z, 80.45h old, d=163) leaves margin/K=0.1850 at or below
  the 0.2223 fire threshold = the commits the tip "
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
AC-201's newest carrier evidence (ts 2026-10-09T13:18:40Z, 80.45h old, d=163) leaves margin/K=0.1850 at or below the 0.2223 fire threshold = the commits the tip advances in one 2.0h observation interval plus one 0.34h coldstart-face run at the worst measured 19 commits/h.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1791841139196` · ts `2026-10-12T21:38:59.196Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-201`、`coldstart-face`
- 涉及文件：
- `.quay/goal-freshness-margin.json`
- `plugin/freshness-producers.json`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on hosts B+C from this host (both answer BatchMode ssh rc=0), passing --driving-profiles with a model name the TARGET host's gateway accepts

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-201`（routine `freshness-refresh`，runId `freshness-refresh-1791841139196`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-201-e398b211.md`