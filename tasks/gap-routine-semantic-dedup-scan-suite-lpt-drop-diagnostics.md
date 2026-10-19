---
id: gap-routine-semantic-dedup-scan-suite-lpt-drop-diagnostics
title: "semantic-dedup-scan: The Transform bodies differ only in renaming the
  local chunk to obj on the Buffer.isBuffer line; suite-scheduler.ts itself
  asserts it is the SAME raw-diagnosti"
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
The Transform bodies differ only in renaming the local chunk to obj on the Buffer.isBuffer line; suite-scheduler.ts itself asserts it is the SAME raw-diagnostic filter suite-lpt-runner.mjs wires.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792405443214` · ts `2026-10-19T10:24:03.214Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`dropRawDiagnostics`、`transform`
- 涉及文件：
- `plugin/scripts/suite-lpt-runner.mjs:43`
- `plugin/scripts/suite-scheduler.ts:365`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `suite-lpt-drop-diagnostics`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792405443214`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/suite-lpt-runner.mjs`
- `plugin/scripts/suite-scheduler.ts`
- `plugin/scripts/measure-suite-reporter.mjs`
- `tasks/gap-routine-semantic-dedup-scan-suite-lpt-drop-diagnostics.md`