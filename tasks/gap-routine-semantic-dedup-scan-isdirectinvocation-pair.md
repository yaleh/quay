---
id: gap-routine-semantic-dedup-scan-isdirectinvocation-pair
title: "semantic-dedup-scan: Byte-identical bodies; fold the pair as-is, but do
  NOT retarget onto name-based isDirectEntry (that is a behavior change), and
  concurrent-batch-scheduler.ts's "
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
Byte-identical bodies; fold the pair as-is, but do NOT retarget onto name-based isDirectEntry (that is a behavior change), and concurrent-batch-scheduler.ts's basename variant is deliberate divergence

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791733865369` · ts `2026-10-11T15:51:05.369Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`isDirectInvocation`
- 涉及文件：
- `plugin/scripts/config-wiring-check.ts:693`
- `plugin/scripts/drivable-workspace-check.ts:247`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `isDirectInvocation-pair`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791733865369`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/config-wiring-check.ts`
- `plugin/scripts/drivable-workspace-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-isdirectinvocation-pair.md`