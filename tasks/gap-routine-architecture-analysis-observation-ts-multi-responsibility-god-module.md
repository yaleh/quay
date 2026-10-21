---
id: gap-routine-architecture-analysis-observation-ts-multi-responsibility-god-module
title: "architecture-analysis: 4797 lines with 64 direct importers and at least
  four unrelated responsibilities in one file: fast-mode event pairing,
  liveness/activity signals, Touches-sec"
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
4797 lines with 64 direct importers and at least four unrelated responsibilities in one file: fast-mode event pairing, liveness/activity signals, Touches-section task-blocking computation, and worker-outcome/mechanical-fan-in record parsing.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792599464308` · ts `2026-10-21T16:17:44.308Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`pairInFlight`、`readActivitySignals`、`decideLiveState`、`computeInFlightBlocking`、`readTaskBlockingInputs`、`parseWorkerOutcomeRecordsDetailed`
- 涉及文件：
- `packages/quay/src/observation.ts:295`
- `packages/quay/src/observation.ts:387`
- `packages/quay/src/observation.ts:474`
- `packages/quay/src/observation.ts:557`
- `packages/quay/src/observation.ts:766`
- kind：`god-module`
- verdict：`confirmed`

## Requested action
Split along those seams into observation/events.ts, observation/liveness.ts, observation/blocking.ts, observation/records.ts and keep observation.ts as a barrel; consumers' imports stay valid.

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `observation-ts-multi-responsibility-god-module`（routine `architecture-analysis`，runId `architecture-analysis-1792599464308`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/observation.ts`
- `tasks/gap-routine-architecture-analysis-observation-ts-multi-responsibility-god-module.md`