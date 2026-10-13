---
id: gap-routine-semantic-dedup-scan-parse-args-adoption-split
title: "semantic-dedup-scan: Split adoption of one canonical: eight sites thinly
  wrap gate-script-base.ts parseArgs while six hand-roll their own token loops
  with genuinely divergent error"
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
Split adoption of one canonical: eight sites thinly wrap gate-script-base.ts parseArgs while six hand-roll their own token loops with genuinely divergent error models (throw vs process.exit(2) vs an error return field vs silent accept of unknown flags).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791908616513` · ts `2026-10-13T16:23:36.513Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseArgs`
- 涉及文件：
- `plugin/scripts/gate-script-base.ts:164`
- `plugin/scripts/accounting-emit.ts:270`
- `plugin/scripts/discovery-path-classify.ts:544`
- `plugin/scripts/guard-lineage-check.ts:381`
- `plugin/scripts/instrument-decay-check.ts:322`
- `plugin/scripts/outer-cron-registry.ts:656`
- `plugin/scripts/phase-declare.ts:268`
- `plugin/scripts/checked-in-write-check.ts:384`
- `plugin/scripts/perfile-failure-rate.ts:280`
- `plugin/scripts/psi-failure-correlation-check.ts:193`
- `plugin/scripts/psi-window-join.ts:155`
- `plugin/scripts/self-report-vocab-check.ts:138`
- `plugin/scripts/suite-scheduler.ts:475`
- `plugin/scripts/workflow-invariant-ownership.mjs:29`
- `plugin/scripts/workflow-metadata-conformance.mjs:711`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
migrate the six hand-rolled parsers onto gate-script-base parseArgs

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `parse-args-adoption-split`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791908616513`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/accounting-emit.ts`
- `plugin/scripts/discovery-path-classify.ts`
- `plugin/scripts/guard-lineage-check.ts`
- `plugin/scripts/instrument-decay-check.ts`
- `plugin/scripts/outer-cron-registry.ts`
- `plugin/scripts/phase-declare.ts`
- `plugin/scripts/checked-in-write-check.ts`
- `plugin/scripts/perfile-failure-rate.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/psi-window-join.ts`
- `plugin/scripts/self-report-vocab-check.ts`
- `plugin/scripts/suite-scheduler.ts`
- `plugin/scripts/workflow-invariant-ownership.mjs`
- `plugin/scripts/workflow-metadata-conformance.mjs`
- `tasks/gap-routine-semantic-dedup-scan-parse-args-adoption-split.md`