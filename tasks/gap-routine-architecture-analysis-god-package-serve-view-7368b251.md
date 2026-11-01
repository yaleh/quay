---
id: gap-routine-architecture-analysis-god-package-serve-view-7368b251
title: "architecture-analysis: fanIn 564 / fanOut 222, 118 entities in 7 files;
  serve-i18n.ts alone is 202KB."
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
fanIn 564 / fanOut 222, 118 entities in 7 files; serve-i18n.ts alone is 202KB.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793492325036` · ts `2026-11-01T00:18:45.036Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`serve-i18n`、`serve-dashboard`、`serve-render`
- 涉及文件：
- `packages/quay/src/serve/view/serve-i18n.ts:1`
- `packages/quay/src/serve/view/serve-dashboard.ts:1`
- `packages/quay/src/serve/view/serve-render.ts:1`
- kind：`god-package`
- verdict：`god-package`

## Requested action
Extract i18n locale strings into data modules and split render vs i18n responsibilities.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T00:18:45.036Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-serve-view`（routine `architecture-analysis`，runId `architecture-analysis-1793492325036`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/serve/view/serve-i18n.ts`
- `packages/quay/src/serve/view/serve-dashboard.ts`
- `packages/quay/src/serve/view/serve-render.ts`
- `tasks/gap-routine-architecture-analysis-god-package-serve-view-7368b251.md`