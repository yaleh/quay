---
id: gap-routine-freshness-refresh-stale-upgrade-face-goal-009-ac-239
title: "freshness-refresh: AC-239 shares the upgrade-face producer and the same
  d=172/margin=28 evidence age as AC-238 (both records are written as an
  UPGRADE-PAIR on one run), so one run "
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
AC-239 shares the upgrade-face producer and the same d=172/margin=28 evidence age as AC-238 (both records are written as an UPGRADE-PAIR on one run), so one run refreshes both — and 0.14 is far below the 0.2975 threshold.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789815175705` · ts `2026-09-19T10:52:55.705Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`GOAL-009-AC-239`、`develop-deliver-tgz.sh --verify-upgrade`
- 涉及文件：
- `plugin/freshness-producers.json:65`
- `plugin/freshness-producers.json:77`
- `.quay/goal-freshness-margin.json:1`
- `plugin/scripts/develop-deliver-tgz.sh:1`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Re-run upgrade-face on host B — same single run covers AC-238 (paired records, identical project_root) — after freeing disk on host B.

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `stale-upgrade-face-goal-009-ac-239`（routine `freshness-refresh`，runId `freshness-refresh-1789815175705`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `plugin/scripts/develop-deliver-tgz.sh`
- `tasks/gap-routine-freshness-refresh-stale-upgrade-face-goal-009-ac-239.md`