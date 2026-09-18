---
id: gap-routine-semantic-dedup-scan-arg-parsing-helper-family
title: "semantic-dedup-scan: ~60 copies of the same indexOf+next-arg idiom
  across 50+ checker/driver scripts under 9 different names; gate-script-base.ts
  is imported by 246 files yet expor"
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
~60 copies of the same indexOf+next-arg idiom across 50+ checker/driver scripts under 9 different names; gate-script-base.ts is imported by 246 files yet exports no arg helper, and parseJsonArg has 5 copies total (2 more found ad hoc in stage-receipt.ts:833 and workflow-journal.ts:620).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1789723686226` · ts `2026-09-18T09:28:06.226Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`getArgValue`、`argValue`、`getFlagValue`、`parseArg`、`flagVal`、`argvFlag`、`parseJsonArg`、`flag`、`flagValue`
- 涉及文件：
- `plugin/scripts/anti-drift-touches-check.ts:105`
- `plugin/scripts/cap-counts-subagents-check.ts:346`
- `plugin/scripts/allowed-tools-plugin-prefix-check.ts:149`
- `plugin/scripts/checker-count-drift-check.ts:185`
- `plugin/scripts/build-evidence-collector.ts:578`
- `plugin/scripts/execution-policy.ts:411`
- `plugin/scripts/ci-red-attribute.ts:369`
- `plugin/scripts/pane-state-classify.ts:676`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `arg-parsing-helper-family`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1789723686226`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/anti-drift-touches-check.ts`
- `plugin/scripts/cap-counts-subagents-check.ts`
- `plugin/scripts/allowed-tools-plugin-prefix-check.ts`
- `plugin/scripts/checker-count-drift-check.ts`
- `plugin/scripts/build-evidence-collector.ts`
- `plugin/scripts/execution-policy.ts`
- `plugin/scripts/ci-red-attribute.ts`
- `plugin/scripts/pane-state-classify.ts`
- `tasks/gap-routine-semantic-dedup-scan-arg-parsing-helper-family.md`