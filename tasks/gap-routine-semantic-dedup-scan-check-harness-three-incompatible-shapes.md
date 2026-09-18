---
id: gap-routine-semantic-dedup-scan-check-harness-three-incompatible-shapes
title: "semantic-dedup-scan: 26 copies of one selftest harness split across
  three mutually incompatible shapes: counters-only (11),
  allPassed+required-detail (10), allPassed+failures[] acc"
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
26 copies of one selftest harness split across three mutually incompatible shapes: counters-only (11), allPassed+required-detail (10), allPassed+failures[] accumulator (5); 8 of 11 body#3 copies already import gate-script-base.ts, and adr/ADR-018 itself names DIR-091 as the extraction mandate.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1789723686226` · ts `2026-09-18T09:28:06.226Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`check`
- 涉及文件：
- `plugin/scripts/adr016-screen-use-check.ts:286`
- `plugin/scripts/build-evidence-manifest.ts:283`
- `plugin/scripts/execution-policy.ts:336`
- `plugin/scripts/config-wiring-check.ts:451`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `check-harness-three-incompatible-shapes`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1789723686226`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/adr016-screen-use-check.ts`
- `plugin/scripts/build-evidence-manifest.ts`
- `plugin/scripts/execution-policy.ts`
- `plugin/scripts/config-wiring-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-check-harness-three-incompatible-shapes.md`