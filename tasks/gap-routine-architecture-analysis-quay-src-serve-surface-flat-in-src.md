---
id: gap-routine-architecture-analysis-quay-src-serve-surface-flat-in-src
title: "architecture-analysis: packages/quay/src carries fanIn 259 / fanOut 662
  / 52 top-level files, of which 24 are serve*/server-state (~15795 lines:
  serve-i18n 2779, serve-dashboard 19"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
packages/quay/src carries fanIn 259 / fanOut 662 / 52 top-level files, of which 24 are serve*/server-state (~15795 lines: serve-i18n 2779, serve-dashboard 1965, serve-render 1303) — the whole web surface sits flat in src/ while cli/, core/, gate/, kernel/ are real subpackages.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792599464308` · ts `2026-10-21T16:17:44.308Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`handleAllRoutes`、`startDashboardSnapshotRefresh`、`startBoardSnapshotRefresh`、`resolveServeBinding`
- 涉及文件：
- `packages/quay/src/serve.ts:19`
- `packages/quay/src/serve-handlers.ts:1`
- `packages/quay/src/serve-dashboard.ts:1`
- `packages/quay/src/serve-i18n.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Mechanically move the serve* family into packages/quay/src/serve/ (matching the cli/core/gate/kernel convention) and re-export from a serve/index.ts; no behavior change.

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `quay-src-serve-surface-flat-in-src`（routine `architecture-analysis`，runId `architecture-analysis-1792599464308`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/serve.ts`
- `packages/quay/src/serve-handlers.ts`
- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/src/serve-i18n.ts`
- `tasks/gap-routine-architecture-analysis-quay-src-serve-surface-flat-in-src.md`