---
id: gap-routine-architecture-analysis-dup-next-sequence-id
title: "architecture-analysis: archguard dup 6e19b6d306d82356: 97 tokens/8
  lines; both scan ^PREFIX-(\\d{3,})$ for max+1, differing only in the AC/GOAL
  literal."
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
archguard dup 6e19b6d306d82356: 97 tokens/8 lines; both scan ^PREFIX-(\d{3,})$ for max+1, differing only in the AC/GOAL literal.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792847950884` · ts `2026-10-24T13:19:10.884Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`nextAcId`、`nextGoalId`
- 涉及文件：
- `plugin/scripts/meta-driver.ts:1217`
- `plugin/scripts/meta-driver.ts:2051`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Replace both with one nextSequenceId(records, prefix, digits) and keep thin wrappers; AC: both ids unchanged on a fixture, no duplicated regex.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-24T13:19:10.884Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-next-sequence-id`（routine `architecture-analysis`，runId `architecture-analysis-1792847950884`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/meta-driver.ts`
- `tasks/gap-routine-architecture-analysis-dup-next-sequence-id.md`