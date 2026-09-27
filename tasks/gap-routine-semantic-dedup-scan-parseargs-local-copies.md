---
id: gap-routine-semantic-dedup-scan-parseargs-local-copies
title: "semantic-dedup-scan: 21 files declare their own parseArgs and only 3
  import the shared one, differing on argv slicing, unknown-arg handling and
  missing-value shape."
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
21 files declare their own parseArgs and only 3 import the shared one, differing on argv slicing, unknown-arg handling and missing-value shape.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790503843524` · ts `2026-09-27T10:10:43.524Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseArgs`
- 涉及文件：
- `plugin/scripts/gate-script-base.ts:51`
- `plugin/scripts/gate-staleness-check.ts:38`
- `plugin/scripts/checked-in-write-check.ts:374`
- `plugin/scripts/loadbearing-test-gate.ts:214`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge onto gate-script-base parseArgs(argv, spec)

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `parseargs-local-copies`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790503843524`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/gate-staleness-check.ts`
- `plugin/scripts/checked-in-write-check.ts`
- `plugin/scripts/loadbearing-test-gate.ts`
- `tasks/gap-routine-semantic-dedup-scan-parseargs-local-copies.md`