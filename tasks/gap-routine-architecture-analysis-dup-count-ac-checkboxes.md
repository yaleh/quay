---
id: gap-routine-architecture-analysis-dup-count-ac-checkboxes
title: "architecture-analysis: Identical AC-checkbox predicate in two layers
  (archguard dup hash 0bb360d4880cd7f4); the fail-closed sectionFound:false/NaN
  rationale comment exists only in "
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
Identical AC-checkbox predicate in two layers (archguard dup hash 0bb360d4880cd7f4); the fail-closed sectionFound:false/NaN rationale comment exists only in the plugin copy, so the product copy reads as an undocumented parallel implementation.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792481915389` · ts `2026-10-20T07:38:35.389Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`countAcCheckboxes`
- 涉及文件：
- `packages/quay/src/task-parsing.ts:109`
- `plugin/scripts/task-schema.ts:429`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Make task-parsing.ts the single implementation (plugin re-exports it) or add a parity test that feeds null/empty/section bodies to both; AC: a test asserts both call sites return equal objects for 4 fixture inputs.

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-count-ac-checkboxes`（routine `architecture-analysis`，runId `architecture-analysis-1792481915389`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/task-parsing.ts`
- `plugin/scripts/task-schema.ts`
- `tasks/gap-routine-architecture-analysis-dup-count-ac-checkboxes.md`