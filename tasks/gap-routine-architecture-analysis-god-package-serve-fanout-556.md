---
id: gap-routine-architecture-analysis-god-package-serve-fanout-556
title: "architecture-analysis: archguard god-packages (scope 075f2c0c @ HEAD
  01bdc8d54): serve/ has fanOut=556, fanIn=12, 25 files, 285 entities, 15687
  lines — highest fanOut in the repo a"
status: todo
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard god-packages (scope 075f2c0c @ HEAD 01bdc8d54): serve/ has fanOut=556, fanIn=12, 25 files, 285 entities, 15687 lines — highest fanOut in the repo and 2.2x the next package; recurrence of the 2026-10-23 finding that was never filed.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792940968187` · ts `2026-10-25T15:09:28.187Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`handleAllRoutes`、`startDashboardSnapshotRefresh`、`resolveServeBinding`
- 涉及文件：
- `packages/quay/src/serve/serve-i18n.ts:1`
- `packages/quay/src/serve/serve-dashboard.ts:1`
- `packages/quay/src/serve/serve-render.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split serve/ into serve/view (i18n 2780 + dashboard 1859 + render 1303) and serve/io (git/tests/task/goal/sessions), leaving serve.ts as the router; AC on serve/ fanOut < 300.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-25T15:09:28.187Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-serve-fanout-556`（routine `architecture-analysis`，runId `architecture-analysis-1792940968187`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/serve/serve-i18n.ts`
- `packages/quay/src/serve/serve-dashboard.ts`
- `packages/quay/src/serve/serve-render.ts`
- `tasks/gap-routine-architecture-analysis-god-package-serve-fanout-556.md`