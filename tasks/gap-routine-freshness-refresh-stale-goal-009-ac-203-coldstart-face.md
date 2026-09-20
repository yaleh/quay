---
id: gap-routine-freshness-refresh-stale-goal-009-ac-203-coldstart-face
title: "freshness-refresh: AC-203's newest delivery evidence is build_sha
  2d3a6fa3580947889d42f8234e9d2fe389386f18 (2026-09-18T04:32:56Z, carrier line
  262); d=161 of K=200 leaves margin 39"
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
AC-203's newest delivery evidence is build_sha 2d3a6fa3580947889d42f8234e9d2fe389386f18 (2026-09-18T04:32:56Z, carrier line 262); d=161 of K=200 leaves margin 39 (fraction 0.195) below the 0.2808 threshold a coldstart-face run needs, so a run started after the next 2h look lands past the window.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789909757223` · ts `2026-09-20T13:09:17.223Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`develop-deliver-tgz.sh`、`GOAL-009-AC-203`、`goal-freshness-margin`
- 涉及文件：
- `plugin/freshness-producers.json:37`
- `plugin/freshness-producers.json:39`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl:262`
- `plugin/scripts/develop-deliver-tgz.sh`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Re-run the coldstart-face producer on hosts B C (one run refreshes AC-203/207/232 together) against the current develop tip.

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-203-coldstart-face`（routine `freshness-refresh`，runId `freshness-refresh-1789909757223`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `plugin/scripts/develop-deliver-tgz.sh`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-203-coldstart-face.md`