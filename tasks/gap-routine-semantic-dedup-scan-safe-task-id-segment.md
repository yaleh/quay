---
id: gap-routine-semantic-dedup-scan-safe-task-id-segment
title: "semantic-dedup-scan: Character-identical path-sanitizer duplicated
  across two files of the same lease-path family; comments claim verbatim reuse
  but each holds a private copy that "
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
Character-identical path-sanitizer duplicated across two files of the same lease-path family; comments claim verbatim reuse but each holds a private copy that can silently diverge on the traversal guard.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791442852793` · ts `2026-10-08T07:00:52.793Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`safeTaskIdSegment`、`_safeTaskIdSegment`
- 涉及文件：
- `plugin/scripts/prepare-admission-check.ts:76`
- `plugin/scripts/proposal-convergence.ts:535`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `safe-task-id-segment`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791442852793`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/prepare-admission-check.ts`
- `plugin/scripts/proposal-convergence.ts`
- `tasks/gap-routine-semantic-dedup-scan-safe-task-id-segment.md`