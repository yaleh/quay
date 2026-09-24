---
id: gap-routine-freshness-refresh-stale-goal-009-ac-239
title: "freshness-refresh: Newest AC-239 evidence shares the same run and
  build_sha (fa1cae20, ts 2026-09-19T11:06:09Z) as AC-238, d=194 of K=200;
  margin/K=0.03 is far under the upgrade-fa"
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
Newest AC-239 evidence shares the same run and build_sha (fa1cae20, ts 2026-09-19T11:06:09Z) as AC-238, d=194 of K=200; margin/K=0.03 is far under the upgrade-face threshold 0.238 and the AC-239 leg has no separate command, so it ages out with AC-238.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1790211057582` · ts `2026-09-24T00:50:57.582Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`verify-upgrade`、`GOAL-009-AC-239`
- 涉及文件：
- `.quay/goal-freshness-margin.json:1`
- `plugin/freshness-producers.json:65`
- `plugin/freshness-producers.json:66`
- `plugin/freshness-producers.json:77`
- `.quay/productization-verification.jsonl:270`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Same single run as AC-238 — re-running upgrade-face on host B after the disk-headroom check refreshes both subjects in one pass; do not attempt a standalone AC-239 command, none exists.

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-239`（routine `freshness-refresh`，runId `freshness-refresh-1790211057582`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-239.md`