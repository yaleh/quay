---
id: gap-routine-semantic-dedup-scan-hostparallelism-missed-import
title: "semantic-dedup-scan: runner-concurrency.ts already exports
  hostParallelism as the shared home (re-exported by full-suite-runner.ts) yet
  pre-verified-round-record.ts re-declares it "
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
runner-concurrency.ts already exports hostParallelism as the shared home (re-exported by full-suite-runner.ts) yet pre-verified-round-record.ts re-declares it locally instead of importing

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790851304231` · ts `2026-10-01T10:41:44.231Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`hostParallelism`
- 涉及文件：
- `plugin/scripts/pre-verified-round-record.ts:516`
- `plugin/scripts/runner-concurrency.ts:43`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
merge — import hostParallelism from runner-concurrency.ts

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `hostparallelism-missed-import`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790851304231`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/pre-verified-round-record.ts`
- `plugin/scripts/runner-concurrency.ts`
- `tasks/gap-routine-semantic-dedup-scan-hostparallelism-missed-import.md`