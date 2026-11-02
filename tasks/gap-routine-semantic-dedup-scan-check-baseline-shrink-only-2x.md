---
id: gap-routine-semantic-dedup-scan-check-baseline-shrink-only-2x
title: "semantic-dedup-scan: Byte-identical wrappers delegating to
  checkBaselineShrinkOnlyShared."
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
Byte-identical wrappers delegating to checkBaselineShrinkOnlyShared.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793622123912` · ts `2026-11-02T12:22:03.912Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`checkBaselineShrinkOnly`
- 涉及文件：
- `plugin/scripts/import-graph-check.ts:733`
- `plugin/scripts/sh-census-check.ts:877`
- kind：`identity-replication`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:22:03.912Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `check-baseline-shrink-only-2x`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793622123912`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/import-graph-check.ts`
- `plugin/scripts/sh-census-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-check-baseline-shrink-only-2x.md`