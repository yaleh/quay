---
id: gap-routine-semantic-dedup-scan-driver-sleep-requeststop-triple
title: "semantic-dedup-scan: Byte-identical requestStop one-liners and
  wakeResolve-augmented sleep bodies redefined in all three resident-loop
  drivers, which could import the existing driv"
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
Byte-identical requestStop one-liners and wakeResolve-augmented sleep bodies redefined in all three resident-loop drivers, which could import the existing driver-shared.ts instead.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791442852793` · ts `2026-10-08T07:00:52.793Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`sleep`、`requestStop`
- 涉及文件：
- `plugin/scripts/outer-driver.ts:410`
- `plugin/scripts/promotion-driver.ts:795`
- `plugin/scripts/quality-gate-driver.ts:1059`
- `plugin/scripts/outer-driver.ts:415`
- `plugin/scripts/promotion-driver.ts:802`
- `plugin/scripts/quality-gate-driver.ts:1063`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `driver-sleep-requeststop-triple`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791442852793`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/driver-shared.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/outer-driver.ts`
- `plugin/scripts/promotion-driver.ts`
- `plugin/scripts/quality-gate-driver.ts`
- `plugin/test/driver-shared.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-driver-sleep-requeststop-triple.md`