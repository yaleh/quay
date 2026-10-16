---
id: gap-routine-semantic-dedup-scan-read-file-join-root-pair
title: "semantic-dedup-scan: Byte-identical `path.join(root,rel)` + `existsSync
  ? readFileSync : ''` under the same (root,rel) contract in two sibling
  checkers that both already import gat"
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
Byte-identical `path.join(root,rel)` + `existsSync ? readFileSync : ''` under the same (root,rel) contract in two sibling checkers that both already import gate-script-base.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792168649663` · ts `2026-10-16T16:37:29.663Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readFile`
- 涉及文件：
- `plugin/scripts/dual-source-check.ts:66`
- `plugin/scripts/retired-clause-check.ts:196`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract — one shared root-relative reader

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `read-file-join-root-pair`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792168649663`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/dual-source-check.ts`
- `plugin/scripts/retired-clause-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-read-file-join-root-pair.md`