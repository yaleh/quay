---
id: gap-routine-architecture-analysis-dup-discovery-module-loader
title: "architecture-analysis: archguard dup hash d5a5945972ad7036 (177 tokens /
  17 lines): the `load` arrow that resolves an engine module, memoizes into
  _engineModuleCache, imports via p"
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
archguard dup hash d5a5945972ad7036 (177 tokens / 17 lines): the `load` arrow that resolves an engine module, memoizes into _engineModuleCache, imports via pathToFileURL and pushes an `unresolved` message is byte-identical in the two sibling routine files (2,241 and 5,682 lines), so the unresolved-reason wording and cache semantics must be edited twice.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792752934532` · ts `2026-10-23T10:55:34.532Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`load`、`loadDiscoveryModules`、`loadOpenDiscoveryModules`、`resolveEngineModule`、`_engineModuleCache`
- 涉及文件：
- `plugin/scripts/discovery-method-routine.ts:1187`
- `plugin/scripts/open-semantic-discovery-routine.ts:1950`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one `makeEngineModuleLoader(root, cache, unresolved[])` into a shared routine lib and have both loaders call it.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-23T10:55:34.532Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-discovery-module-loader`（routine `architecture-analysis`，runId `architecture-analysis-1792752934532`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/scripts/open-semantic-discovery-routine.ts`
- `tasks/gap-routine-architecture-analysis-dup-discovery-module-loader.md`