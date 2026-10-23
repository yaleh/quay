---
id: gap-routine-semantic-dedup-scan-rev-parse-head-identical
title: "semantic-dedup-scan: Bodies identical including the SHA regex and
  try/catch-null, and both take the same single root parameter, so the two names
  are purely historical."
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
Bodies identical including the SHA regex and try/catch-null, and both take the same single root parameter, so the two names are purely historical.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792752400273` · ts `2026-10-23T10:46:40.273Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`revParseHead`、`revParseHeadOf`
- 涉及文件：
- `plugin/scripts/ready-pool-check.ts:3793`
- `plugin/scripts/driver-filters.ts:1225`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-23T10:46:40.273Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `rev-parse-head-identical`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792752400273`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/ready-pool-check.ts`
- `plugin/scripts/driver-filters.ts`
- `tasks/gap-routine-semantic-dedup-scan-rev-parse-head-identical.md`