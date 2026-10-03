---
id: gap-routine-semantic-dedup-scan-store-assertsafestatus-quad
title: "semantic-dedup-scan: Four near-identical bodies differing only in the
  VALID_* status-constant name and the kind word; the shared
  frontmatter-store-base.ts already exists and is imp"
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
Four near-identical bodies differing only in the VALID_* status-constant name and the kind word; the shared frontmatter-store-base.ts already exists and is imported by all four stores but does not factor this validator.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790995446200` · ts `2026-10-03T02:44:06.200Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`assertSafeStatus`
- 涉及文件：
- `packages/quay/src/adr-store.ts:88`
- `packages/quay/src/document-store.ts:76`
- `packages/quay/src/goal-store.ts:1561`
- `packages/quay/src/meta-store.ts:105`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `store-assertSafeStatus-quad`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790995446200`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/adr-store.ts`
- `packages/quay/src/document-store.ts`
- `packages/quay/src/goal-store.ts`
- `packages/quay/src/meta-store.ts`
- `tasks/gap-routine-semantic-dedup-scan-store-assertsafestatus-quad.md`