---
id: gap-routine-semantic-dedup-scan-escaperegexp-sweep-missed-two
title: "semantic-dedup-scan: the documented sweep that collapsed twelve
  byte-identical copies could not see these two semantically identical Set-loop
  rewrites, so a completed dedup is only"
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
the documented sweep that collapsed twelve byte-identical copies could not see these two semantically identical Set-loop rewrites, so a completed dedup is only apparently complete (hard rule 5b).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790503843524` · ts `2026-09-27T10:10:43.524Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`escapeRegExp`
- 涉及文件：
- `packages/quay/src/kernel/regex-escape.ts:49`
- `plugin/scripts/precommit-guard.ts:202`
- `plugin/scripts/select-static-checks-for-touches.ts:202`
- kind：`real-duplication`
- verdict：`real-duplication`

## Requested action
merge onto the kernel leaf, then re-run the family check instead of trusting the 12/12 claim

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `escaperegexp-sweep-missed-two`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790503843524`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/kernel/regex-escape.ts`
- `plugin/scripts/precommit-guard.ts`
- `plugin/scripts/select-static-checks-for-touches.ts`
- `tasks/gap-routine-semantic-dedup-scan-escaperegexp-sweep-missed-two.md`