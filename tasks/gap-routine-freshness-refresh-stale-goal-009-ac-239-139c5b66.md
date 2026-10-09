---
id: gap-routine-freshness-refresh-stale-goal-009-ac-239-139c5b66
title: "freshness-refresh: evidence_ts 2026-09-25T16:27:01Z is 322.71h old and
  d=217 > K=200 (margin -17); note the AC-239 leg has no standalone command —
  its only refresh path is the AC-2"
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
evidence_ts 2026-09-25T16:27:01Z is 322.71h old and d=217 > K=200 (margin -17); note the AC-239 leg has no standalone command — its only refresh path is the AC-238 run, and a PARTIAL run refreshes AC-238 while leaving AC-239 on the old reading

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1791515642323` · ts `2026-10-09T03:14:02.323Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`GOAL-009-AC-239`
- 涉及文件：
- `plugin/freshness-producers.json`
- `.quay/productization-verification.jsonl`
- `.quay/goal-freshness-margin.json`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run upgrade-face on host B and verify the run is a full UPGRADE-PAIR (not PARTIAL), since AC-239 ages out only when that run succeeds

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-239`（routine `freshness-refresh`，runId `freshness-refresh-1791515642323`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-239-139c5b66.md`