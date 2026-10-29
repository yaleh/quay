---
id: gap-routine-architecture-analysis-god-function-creategoalstore
title: "architecture-analysis: createGoalStore is a single 1,647-line closure
  factory (lines 1155-2802) with 20 nested declarations inside a
  3,427-line/43-export module — the remainder aft"
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
createGoalStore is a single 1,647-line closure factory (lines 1155-2802) with 20 nested declarations inside a 3,427-line/43-export module — the remainder after the 2026-10-24 extraction of criterion-attribution and goal-staleness.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793251760204` · ts `2026-10-29T05:29:20.204Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`createGoalStore`、`toViewModel`、`listWithMalformed`、`checkAchievedFailing`、`checkReverifyScope`
- 涉及文件：
- `packages/quay/src/core/goal-store.ts:1155`
- `packages/quay/src/core/goal-store.ts:2802`
- kind：`god-function`
- verdict：`confirmed`

## Requested action
Extract the factory's sub-surfaces (criterion reads, staleness/achieved checks, ledger+capability gates) into modules createGoalStore composes, targeting <400 lines per module.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T05:29:20.204Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-function-createGoalStore`（routine `architecture-analysis`，runId `architecture-analysis-1793251760204`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/core/goal-store.ts`
- `tasks/gap-routine-architecture-analysis-god-function-creategoalstore.md`