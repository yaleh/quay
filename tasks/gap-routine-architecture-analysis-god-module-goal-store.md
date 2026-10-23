---
id: gap-routine-architecture-analysis-god-module-goal-store
title: "architecture-analysis: 4,167 lines / 64 exports / 34 importers in one
  module (archguard: quay/src/core fanIn 221) carrying at least five separable
  jobs — criterion-root/tree resolu"
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
4,167 lines / 64 exports / 34 importers in one module (archguard: quay/src/core fanIn 221) carrying at least five separable jobs — criterion-root/tree resolution (L130-367), frozen-population rotation (L368-690), bounded ledger scan + staleness signal (L513-921), the implicit-exit and errexit-abort shell-statement parsers (L1117-1730), and M1 time columns + CLI wiring (L1733-3600).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792752934532` · ts `2026-10-23T10:55:34.532Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`createGoalStore`、`evaluateCriterionAttribution`、`resolveGoalStaleness`、`readGoalConfig`、`resolveCriterionRoot`、`runGoalStoreCli`
- 涉及文件：
- `packages/quay/src/core/goal-store.ts:1`
- `packages/quay/src/core/goal-store.ts:1117`
- `packages/quay/src/core/goal-store.ts:1529`
- kind：`god-module`
- verdict：`confirmed`

## Requested action
Split the criterion-attribution parsers (L1117-1730) into core/criterion-attribution.ts and the staleness signal into core/goal-staleness.ts, keeping goal-store.ts as the store + CLI surface.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-23T10:55:34.532Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-module-goal-store`（routine `architecture-analysis`，runId `architecture-analysis-1792752934532`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/core/goal-store.ts`
- `tasks/gap-routine-architecture-analysis-god-module-goal-store.md`