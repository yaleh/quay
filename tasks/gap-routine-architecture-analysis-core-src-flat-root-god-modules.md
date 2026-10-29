---
id: gap-routine-architecture-analysis-core-src-flat-root-god-modules
title: "architecture-analysis: archguard flags the packages/quay/src root as a
  god package (29 files, 334 entities, tooManyFiles+tooManyEntities): init.ts
  4,154 lines/79 exports, observati"
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
archguard flags the packages/quay/src root as a god package (29 files, 334 entities, tooManyFiles+tooManyEntities): init.ts 4,154 lines/79 exports, observation.ts 3,907 lines/169 exports, mcp-handlers.ts 1,228 lines, serve-i18n.ts 2,780 lines/65 exports — no domain grouping.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793251760204` · ts `2026-10-29T05:29:20.204Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`init`、`observation`、`mcp-handlers`、`buildInitReport`
- 涉及文件：
- `packages/quay/src/init.ts:1`
- `packages/quay/src/observation.ts:1`
- `packages/quay/src/mcp-handlers.ts:1`
- `packages/quay/src/serve/view/serve-i18n.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Group the 29 root modules into domain subpackages (init/, observation/, mcp/) and split observation.ts's 169 exports and init.ts by phase, leaving explicit index surfaces.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T05:29:20.204Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `core-src-flat-root-god-modules`（routine `architecture-analysis`，runId `architecture-analysis-1793251760204`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/init.ts`
- `packages/quay/src/observation.ts`
- `packages/quay/src/mcp-handlers.ts`
- `packages/quay/src/serve/view/serve-i18n.ts`
- `tasks/gap-routine-architecture-analysis-core-src-flat-root-god-modules.md`