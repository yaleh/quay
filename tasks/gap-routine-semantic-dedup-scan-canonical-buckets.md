---
id: gap-routine-semantic-dedup-scan-canonical-buckets
title: "semantic-dedup-scan: Identical three-line bodies plus an identical
  private BUCKET_ORDER array in each file, and the kernel re-export pattern
  already used for regex-escape is a reac"
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
Identical three-line bodies plus an identical private BUCKET_ORDER array in each file, and the kernel re-export pattern already used for regex-escape is a reachable shared placement.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792560001684` · ts `2026-10-21T05:20:01.684Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`canonicalBuckets`
- 涉及文件：
- `plugin/scripts/suite-bucket-attribution.ts:354`
- `packages/quay/src/serve-tests.ts:481`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `canonical-buckets`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792560001684`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/suite-bucket-attribution.ts`
- `packages/quay/src/serve-tests.ts`
- `tasks/gap-routine-semantic-dedup-scan-canonical-buckets.md`