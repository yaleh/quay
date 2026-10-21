---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205
title: "freshness-refresh: AC-205's newest evidence (ts 2026-10-12T21:59:06Z) is
  205.43h old and only 3 delivery-face commits from the k=200 window edge; the
  most recent producer run (2026"
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
AC-205's newest evidence (ts 2026-10-12T21:59:06Z) is 205.43h old and only 3 delivery-face commits from the k=200 window edge; the most recent producer run (2026-10-20T10:03:31Z) wrote AC-201/203/207/232 but no AC-205 record, so the session-delivery leg is the one that aged out.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792582022361` · ts `2026-10-21T11:27:02.361Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-205`、`session-delivery`
- 涉及文件：
- `.quay/productization-verification.jsonl:360`
- `.quay/goal-freshness-margin.json:1`
- `plugin/freshness-producers.json:156`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run session-delivery (develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C") from a host authorized to B AND C and holding a live inbound-accepting session on the verify host (its declared precondition), with --driving-profiles naming a model the target-host gateway accepts

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-205`（routine `freshness-refresh`，runId `freshness-refresh-1792582022361`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205.md`