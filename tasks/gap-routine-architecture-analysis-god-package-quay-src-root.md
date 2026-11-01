---
id: gap-routine-architecture-analysis-god-package-quay-src-root
title: "architecture-analysis: fanIn 484 / fanOut 423, 296 entities in 29 files
  — root aggregates cli/core/kernel/serve/observation/gate."
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
fanIn 484 / fanOut 423, 296 entities in 29 files — root aggregates cli/core/kernel/serve/observation/gate.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793492325036` · ts `2026-11-01T00:18:45.036Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`dashboard-kernel`、`mcp-server`、`goal-merge`
- 涉及文件：
- `packages/quay/src/dashboard-kernel.ts:1`
- `packages/quay/src/mcp-server.ts:1`
- `packages/quay/src/goal-merge.ts:1`
- kind：`god-package`
- verdict：`god-package`

## Requested action
Move root-level modules into their owning sub-package, keeping only true barrel re-exports.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T00:18:45.036Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-quay-src-root`（routine `architecture-analysis`，runId `architecture-analysis-1793492325036`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/dashboard-kernel.ts`
- `packages/quay/src/mcp-server.ts`
- `packages/quay/src/goal-merge.ts`
- `tasks/gap-routine-architecture-analysis-god-package-quay-src-root.md`