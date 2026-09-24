---
id: gap-routine-freshness-refresh-stale-goal-009-ac-238
title: "freshness-refresh: Newest AC-238 evidence is build_sha fa1cae20 at ts
  2026-09-19T11:06:09Z, already d=194 of K=200 delivery-face commits behind the
  develop tip; margin/K=0.03 is fa"
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
Newest AC-238 evidence is build_sha fa1cae20 at ts 2026-09-19T11:06:09Z, already d=194 of K=200 delivery-face commits behind the develop tip; margin/K=0.03 is far under the upgrade-face threshold 0.238, so the subject crosses out of the freshness window before a producer started now could land.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1790211057582` · ts `2026-09-24T00:50:57.582Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`verify-upgrade`、`GOAL-009-AC-238`
- 涉及文件：
- `.quay/goal-freshness-margin.json:1`
- `plugin/freshness-producers.json:65`
- `plugin/freshness-producers.json:66`
- `plugin/freshness-producers.json:76`
- `.quay/productization-verification.jsonl:269`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Verify host B has disk headroom first (`ssh orangevps 'df -h /'`; measured 100% full on 2026-09-19) and only then re-run upgrade-face on host B (--hosts B) against the aged source; if disk is still full this is a human-authorized ops step, not a producer re-run.

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-238`（routine `freshness-refresh`，runId `freshness-refresh-1790211057582`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-238.md`