---
id: gap-routine-architecture-analysis-workflow-replay-stage-order-predicates
title: "architecture-analysis: Four methods share one body shape —
  findIndex(stageA), findIndex(stageB), two -1 guards, one index comparison —
  differing only in stage names and comparison "
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
Four methods share one body shape — findIndex(stageA), findIndex(stageB), two -1 guards, one index comparison — differing only in stage names and comparison direction (archguard groups them as two structural clones at 202 and 106 tokens).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793162787359` · ts `2026-10-28T04:46:27.359Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`auditAfterNullBuild`、`verifyBeforePrepared`、`auditCompletesBeforeLand`、`gateRunsAfterAudit`
- 涉及文件：
- `plugin/scripts/workflow-replay.ts:156`
- `plugin/scripts/workflow-replay.ts:161`
- `plugin/scripts/workflow-replay.ts:182`
- `plugin/scripts/workflow-replay.ts:187`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Replace with one stageOrder(events, a, b, 'before'|'after') helper so a new ordering invariant cannot silently inherit a copied direction bug.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T04:46:27.359Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `workflow-replay-stage-order-predicates`（routine `architecture-analysis`，runId `architecture-analysis-1793162787359`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/workflow-replay.ts`
- `tasks/gap-routine-architecture-analysis-workflow-replay-stage-order-predicates.md`