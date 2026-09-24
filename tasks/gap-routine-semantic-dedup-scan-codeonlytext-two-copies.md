---
id: gap-routine-semantic-dedup-scan-codeonlytext-two-copies
title: "semantic-dedup-scan: codeOnlyText is byte-identical (only the doc
  comment differs) and both files carry maskComments; the two files are not a
  whole-file fork (378 vs 384 lines, nea"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
codeOnlyText is byte-identical (only the doc comment differs) and both files carry maskComments; the two files are not a whole-file fork (378 vs 384 lines, near-disjoint exports) so the true residual overlap is this helper pair

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790218481576` · ts `2026-09-24T02:54:41.576Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`codeOnlyText`、`maskComments`
- 涉及文件：
- `plugin/scripts/fan-in-workflow-retirement-check.ts:215`
- `plugin/scripts/outer-retirement-precondition-check.ts:169`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `codeonlytext-two-copies`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790218481576`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/source-text-lib.ts`
- `plugin/scripts/fan-in-workflow-retirement-check.ts`
- `plugin/scripts/outer-retirement-precondition-check.ts`
- `plugin/scripts/registry-bare-filename-scan.ts`
- `plugin/test/source-text-lib.test.mjs`
- `plugin/scripts/capability-catalog-declarations.json`
- `tasks/gap-routine-semantic-dedup-scan-codeonlytext-two-copies.md`