---
id: gap-routine-semantic-dedup-scan-assert-safe-id-quad
title: "semantic-dedup-scan: frontmatter-store-base.ts already abstracts
  makeAssertSafeStatus for the four stores, but assertSafeId was left as four
  near-identical locals (differing only i"
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
frontmatter-store-base.ts already abstracts makeAssertSafeStatus for the four stores, but assertSafeId was left as four near-identical locals (differing only in regex + kind word); native store's same-named function is a coincidental path-traversal-guarded variant.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791238550062` · ts `2026-10-05T22:15:50.062Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`assertSafeId`
- 涉及文件：
- `packages/quay/src/adr-store.ts:82`
- `packages/quay/src/document-store.ts:70`
- `packages/quay/src/meta-store.ts:99`
- `packages/quay/src/goal-store.ts:1741`
- kind：`same-symbol-multi-file`
- verdict：`divergent-implementation`

## Requested action
extract makeAssertSafeId(kind, re) into frontmatter-store-base.ts mirroring makeAssertSafeStatus; do not merge native store

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `assert-safe-id-quad`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791238550062`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/adr-store.ts`
- `packages/quay/src/document-store.ts`
- `packages/quay/src/meta-store.ts`
- `packages/quay/src/goal-store.ts`
- `tasks/gap-routine-semantic-dedup-scan-assert-safe-id-quad.md`