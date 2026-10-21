---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205-ceacd300
title: "freshness-refresh: AC-205 is already past the window (d=201 > K=200,
  margin -1) with its newest evidence 209.43h old (2026-10-12T21:59:06Z), while
  producer_latest_ts=2026-10-20T10:"
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
AC-205 is already past the window (d=201 > K=200, margin -1) with its newest evidence 209.43h old (2026-10-12T21:59:06Z), while producer_latest_ts=2026-10-20T10:03:31Z shows that run refreshed the other four coldstart subjects (all margin 172) but not this one.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792596458238` · ts `2026-10-21T15:27:38.238Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`session-delivery`、`GOAL-009-AC-205`
- 涉及文件：
- `.quay/productization-verification.jsonl`
- `plugin/freshness-producers.json`
- `plugin/scripts/verify-deliver-coldstart.sh`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run session-delivery on host B (and C) — but only a live, inbound-permitting session on either host will actually append an AC-205 record

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-205`（routine `freshness-refresh`，runId `freshness-refresh-1792596458238`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205-ceacd300.md`