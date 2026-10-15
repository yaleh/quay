---
id: gap-routine-semantic-dedup-scan-print-json-three-behaviours
title: "semantic-dedup-scan: One name spans three shapes: three byte-identical
  console.log(JSON.stringify(x)), two pretty-printers that are one behaviour in
  two spellings, and a third pret"
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
One name spans three shapes: three byte-identical console.log(JSON.stringify(x)), two pretty-printers that are one behaviour in two spellings, and a third pretty variant with a different signature — extraction must respect that core cannot import plugin sources.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792033478766` · ts `2026-10-15T03:04:38.766Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`printJson`
- 涉及文件：
- `plugin/scripts/run-identity.ts:471`
- `plugin/scripts/stage-receipt.ts:800`
- `plugin/scripts/workflow-journal.ts:607`
- `plugin/scripts/guard-lineage-check.ts:465`
- `plugin/scripts/worktree-process-reaper.ts:517`
- `packages/quay/src/cli/shared.ts:41`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `print-json-three-behaviours`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792033478766`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/run-identity.ts`
- `plugin/scripts/stage-receipt.ts`
- `plugin/scripts/workflow-journal.ts`
- `plugin/scripts/guard-lineage-check.ts`
- `plugin/scripts/worktree-process-reaper.ts`
- `packages/quay/src/cli/shared.ts`
- `tasks/gap-routine-semantic-dedup-scan-print-json-three-behaviours.md`