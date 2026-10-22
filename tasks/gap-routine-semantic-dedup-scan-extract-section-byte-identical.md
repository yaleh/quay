---
id: gap-routine-semantic-dedup-scan-extract-section-byte-identical
title: "semantic-dedup-scan: Depth-aware heading extractor is byte-identical
  (same escapeRegExp call, same stopRe logic); task-schema.ts neither imports
  nor re-exports the product copy, so"
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
Depth-aware heading extractor is byte-identical (same escapeRegExp call, same stopRe logic); task-schema.ts neither imports nor re-exports the product copy, so the twin is hand-maintained and only parity-tested.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792647604889` · ts `2026-10-22T05:40:04.889Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`extractSection`
- 涉及文件：
- `plugin/scripts/task-schema.ts:88`
- `packages/quay/src/task-parsing.ts:55`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `extract-section-byte-identical`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792647604889`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/task-schema.ts`
- `packages/quay/src/task-parsing.ts`
- `tasks/gap-routine-semantic-dedup-scan-extract-section-byte-identical.md`