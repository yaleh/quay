---
id: gap-routine-architecture-analysis-fan-hub-quay-src
title: "architecture-analysis: packages/quay/src has fanIn=486 fanOut=424 across
  30 files incl. 3907-line observation.ts and 2965-line init.ts"
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
packages/quay/src has fanIn=486 fanOut=424 across 30 files incl. 3907-line observation.ts and 2965-line init.ts

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793622670475` · ts `2026-11-02T12:31:10.475Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`liveSessionIdForPid`、`classifyConfig`
- 涉及文件：
- `packages/quay/src/observation.ts:221`
- `packages/quay/src/init.ts:177`
- kind：`god-package`
- verdict：`CONFIRMED`

## Requested action
Split observation/init monoliths and remove the re-export barrel so subpackages import each other directly

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:31:10.475Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `fan-hub-quay-src`（routine `architecture-analysis`，runId `architecture-analysis-1793622670475`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/observation.ts`
- `packages/quay/src/init.ts`
- `tasks/gap-routine-architecture-analysis-fan-hub-quay-src.md`