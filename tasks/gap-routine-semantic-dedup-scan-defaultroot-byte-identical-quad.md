---
id: gap-routine-semantic-dedup-scan-defaultroot-byte-identical-quad
title: "semantic-dedup-scan: Three defaultRoot bodies are byte-identical
  (path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')) and a
  fourth sibling has already migrated "
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
Three defaultRoot bodies are byte-identical (path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')) and a fourth sibling has already migrated to the sanctioned path.resolve(mainCheckoutRoot(here) or repoRoot(here)) form.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792033478766` · ts `2026-10-15T03:04:38.766Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`defaultRoot`
- 涉及文件：
- `plugin/scripts/checker-count-drift-check.ts:151`
- `plugin/scripts/import-graph-check.ts:834`
- `plugin/scripts/sh-census-check.ts:1035`
- `plugin/scripts/task-granularity-advice.ts:909`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `defaultroot-byte-identical-quad`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792033478766`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/checker-count-drift-check.ts`
- `plugin/scripts/import-graph-check.ts`
- `plugin/scripts/sh-census-check.ts`
- `plugin/scripts/task-granularity-advice.ts`
- `tasks/gap-routine-semantic-dedup-scan-defaultroot-byte-identical-quad.md`