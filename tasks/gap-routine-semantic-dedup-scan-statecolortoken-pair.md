---
id: gap-routine-semantic-dedup-scan-statecolortoken-pair
title: "semantic-dedup-scan: Identical 3-way token mapping over the identical
  domain; serve-tests.ts:288-291 documents re-copying it because
  serve-dashboard's version is module-private and"
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
Identical 3-way token mapping over the identical domain; serve-tests.ts:288-291 documents re-copying it because serve-dashboard's version is module-private and an AC forbids a same-named function, so drift exposure is confined to three token literals.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790306065833` · ts `2026-09-25T03:14:25.833Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`stateColorToken`、`timelineColorToken`
- 涉及文件：
- `packages/quay/src/serve-dashboard.ts:162`
- `packages/quay/src/serve-tests.ts:292`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `statecolortoken-pair`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790306065833`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/src/serve-tests.ts`
- `tasks/gap-routine-semantic-dedup-scan-statecolortoken-pair.md`