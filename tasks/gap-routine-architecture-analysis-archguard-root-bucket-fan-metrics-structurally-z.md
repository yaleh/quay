---
id: gap-routine-architecture-analysis-archguard-root-bucket-fan-metrics-structurally-z
title: "architecture-analysis: archguard's god-package path builds fanIn/fanOut
  from extractPackageName(entityId), which returns `<file>.ts` for root-level
  entities (e.g. 'action.ts.delive"
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
archguard's god-package path builds fanIn/fanOut from extractPackageName(entityId), which returns `<file>.ts` for root-level entities (e.g. 'action.ts.deliverTrigger' -> 'action.ts'), but emits package names taken from engine.getPackageStats(), which buckets those same files as '(root)'; the two name spaces never intersect, so '(root)' reports fanIn=0/fanOut=0 by construction — measured on the fresh 2026-11-08 scopes: src 26b300e9 '(root)' = 30 files / 298 entities with 24 root-file pseudo-packages collapsing 405 fanIn + 531 fanOut relations to 0/0, and scripts 4747cc54 '(root)' = 321 files / 4918 entities with 0/0. Both buckets can therefore only ever be flagged by tooManyFiles/tooManyEntities, never highFanIn/highFanOut — the exact rule-4 shape (a value that cannot come out non-zero is not a measurement).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794127547195` · ts `2026-11-08T08:45:47.195Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`extractPackageName`、`computePackageFanMetricsFromRelations`、`buildTypeScriptGodPackageMetrics`、`evaluateGodPackages`
- 涉及文件：
- `plugin/scripts/archguard-runner.ts:1`
- `.archguard/query/26b300e9/arch.json:1`
- `.archguard/query/4747cc54/arch.json:1`
- `packages/quay/src/action.ts:1`
- kind：`instrument-defect`
- verdict：`CONFIRMED — a structurally-zero value reported as a reading`

## Requested action
Fix in archguard: union '(root)' with its per-file pseudo-packages (or feed getPackageStats() names into extractPackageName) before applying minFanIn/minFanOut, and add a fixture scope whose root dir has heavy in/out edges asserting fanIn>0 for '(root)'.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T08:45:47.195Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `archguard-root-bucket-fan-metrics-structurally-zero`（routine `architecture-analysis`，runId `architecture-analysis-1794127547195`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/archguard-runner.ts`
- `.archguard/query/26b300e9/arch.json`
- `.archguard/query/4747cc54/arch.json`
- `packages/quay/src/action.ts`
- `tasks/gap-routine-architecture-analysis-archguard-root-bucket-fan-metrics-structurally-z.md`