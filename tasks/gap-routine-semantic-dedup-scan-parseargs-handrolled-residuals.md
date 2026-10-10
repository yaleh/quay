---
id: gap-routine-semantic-dedup-scan-parseargs-handrolled-residuals
title: "semantic-dedup-scan: A spec-driven parser exists in gate-script-base.ts
  and several scripts import it, but a residual set still hand-rolls generic
  flag loops."
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
A spec-driven parser exists in gate-script-base.ts and several scripts import it, but a residual set still hand-rolls generic flag loops.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791631645924` · ts `2026-10-10T11:27:25.924Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseArgs`
- 涉及文件：
- `plugin/scripts/obligation-ledger.ts:306`
- `plugin/scripts/checked-in-write-check.ts:374`
- `plugin/scripts/start-drivers.ts:674`
- `plugin/scripts/suite-scheduler.ts:457`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
unify

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `parseargs-handrolled-residuals`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791631645924`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/obligation-ledger.ts`
- `plugin/scripts/checked-in-write-check.ts`
- `plugin/scripts/start-drivers.ts`
- `plugin/scripts/suite-scheduler.ts`
- `tasks/gap-routine-semantic-dedup-scan-parseargs-handrolled-residuals.md`