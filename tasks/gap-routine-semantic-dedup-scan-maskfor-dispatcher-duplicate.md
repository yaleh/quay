---
id: gap-routine-semantic-dedup-scan-maskfor-dispatcher-duplicate
title: "semantic-dedup-scan: Both are the identical three-line sh/ts
  comment-mask dispatcher, and deletion-closure-check already imports both masks
  from identity-replication-check, leaving"
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
Both are the identical three-line sh/ts comment-mask dispatcher, and deletion-closure-check already imports both masks from identity-replication-check, leaving only the dispatcher duplicated.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792287725786` · ts `2026-10-18T01:42:05.786Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`maskFor`
- 涉及文件：
- `plugin/scripts/deletion-closure-check.ts:84`
- `plugin/scripts/identity-replication-check.ts:193`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `maskfor-dispatcher-duplicate`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792287725786`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/identity-replication-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-maskfor-dispatcher-duplicate.md`