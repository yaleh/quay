---
id: gap-routine-semantic-dedup-scan-readtasks-duplicate
title: "semantic-dedup-scan: the first two carry the same tasks/<id>.md to
  {id,body} reader (vanished-id skip) while a canonical single-task parser
  already exists in task-schema.ts; the th"
status: todo
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
the first two carry the same tasks/<id>.md to {id,body} reader (vanished-id skip) while a canonical single-task parser already exists in task-schema.ts; the third is a different bulk projection and is not a superset

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793943196283` · ts `2026-11-06T05:33:16.283Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readTasks`
- 涉及文件：
- `plugin/scripts/inner-wakeup-heartbeat-check.ts:556`
- `plugin/scripts/ready-pool-check.ts:4131`
- `plugin/scripts/long-term-guarantee-goal-backed-check.ts:106`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T05:33:16.283Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `readtasks-duplicate`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793943196283`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/inner-wakeup-heartbeat-check.ts`
- `plugin/scripts/ready-pool-check.ts`
- `plugin/scripts/long-term-guarantee-goal-backed-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-readtasks-duplicate.md`