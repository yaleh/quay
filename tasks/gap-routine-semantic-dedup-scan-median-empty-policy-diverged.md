---
id: gap-routine-semantic-dedup-scan-median-empty-policy-diverged
title: "semantic-dedup-scan: Same even-average core but the empty-set reading
  diverges: 0 (fast-mode-telemetry, workflow-baseline-metrics) vs null
  (resource-anomaly-detector, which also pr"
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
Same even-average core but the empty-set reading diverges: 0 (fast-mode-telemetry, workflow-baseline-metrics) vs null (resource-anomaly-detector, which also pre-filters non-finite) vs NaN (rework-predictors), and crystallization-half-life rounds to 1 decimal — a missing-vs-zero conflation (硬规则 6).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792168649663` · ts `2026-10-16T16:37:29.663Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`median`
- 涉及文件：
- `plugin/scripts/crystallization-half-life.ts:806`
- `plugin/scripts/fast-mode-telemetry.ts:1367`
- `plugin/scripts/resource-anomaly-detector.ts:172`
- `plugin/scripts/rework-predictors.ts:272`
- `plugin/scripts/workflow-baseline-metrics.ts:109`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge — one median with an explicit empty policy

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `median-empty-policy-diverged`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792168649663`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/crystallization-half-life.ts`
- `plugin/scripts/fast-mode-telemetry.ts`
- `plugin/scripts/resource-anomaly-detector.ts`
- `plugin/scripts/rework-predictors.ts`
- `plugin/scripts/workflow-baseline-metrics.ts`
- `tasks/gap-routine-semantic-dedup-scan-median-empty-policy-diverged.md`