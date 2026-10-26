---
id: gap-routine-architecture-analysis-dup-readtouches-closure-driver-filters
title: "architecture-analysis: archguard exact-clone 7fab593681548b81 (89 tokens
  / 6 statements / 10 lines): makeTouchesAttributor re-inlines the
  readTouches+expand closure that makeTouche"
status: todo
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard exact-clone 7fab593681548b81 (89 tokens / 6 statements / 10 lines): makeTouchesAttributor re-inlines the readTouches+expand closure that makeTouchesSideReaders already builds and that three other call sites (260, 452, 571) already consume, so the touchesDisjoint predicate and the GOAL-037 attributor can silently start reading the same tasks/<id>.md differently.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793051973088` · ts `2026-10-26T21:59:33.088Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`makeTouchesSideReaders`、`makeTouchesAttributor`、`readTouches`、`expandDeclaredTouches`
- 涉及文件：
- `plugin/scripts/driver-filters.ts:274`
- `plugin/scripts/driver-filters.ts:1741`
- `plugin/scripts/driver-filters.ts:1742`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Have makeTouchesAttributor call const { expand, readTouches } = makeTouchesSideReaders(ctx) instead of re-declaring them; AC = archguard detect_duplicates on scope 4747cc54 no longer returns group 7fab593681548b81, and driver-filters tests that pin touchesDisjoint byte-parity plus the GOAL-037 attributor tests stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T21:59:33.088Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-readtouches-closure-driver-filters`（routine `architecture-analysis`，runId `architecture-analysis-1793051973088`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/driver-filters.ts`
- `tasks/gap-routine-architecture-analysis-dup-readtouches-closure-driver-filters.md`