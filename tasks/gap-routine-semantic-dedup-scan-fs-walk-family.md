---
id: gap-routine-semantic-dedup-scan-fs-walk-family
title: "semantic-dedup-scan: 22 recursive readdirSync({withFileTypes:true})
  walkers across 19 files share one skeleton (try/catch-return + Dirent loop +
  sorted output) and differ ONLY in t"
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
22 recursive readdirSync({withFileTypes:true}) walkers across 19 files share one skeleton (try/catch-return + Dirent loop + sorted output) and differ ONLY in the skip-set/roots/ext constants — four of the six cited pairs are byte-identical code, the other two differ only in comments.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1789322638156` · ts `2026-09-13T18:03:58.156Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`walk`
- 涉及文件：
- `plugin/scripts/adr016-screen-use-check.ts:169`
- `plugin/scripts/dead-code-after-return-check.ts:122`
- `plugin/scripts/kernel-sibling-resolution-check.ts:438`
- `plugin/scripts/target-identity-literal-check.ts:190`
- `plugin/scripts/concurrency-literal-check.ts:262`
- `plugin/scripts/suite-slot-ssot-check.ts:64`
- `plugin/scripts/deletion-closure-check.ts:96`
- `plugin/scripts/identity-replication-check.ts:110`
- `plugin/scripts/derive-touches-heuristic.ts:88`
- `plugin/scripts/touches-orthogonality-check.ts:138`
- `plugin/scripts/threshold-scope-check.ts:152`
- `plugin/scripts/tick-core-static-check.ts:249`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `fs-walk-family`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1789322638156`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/adr016-screen-use-check.ts`
- `plugin/scripts/dead-code-after-return-check.ts`
- `plugin/scripts/kernel-sibling-resolution-check.ts`
- `plugin/scripts/target-identity-literal-check.ts`
- `plugin/scripts/concurrency-literal-check.ts`
- `plugin/scripts/suite-slot-ssot-check.ts`
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/identity-replication-check.ts`
- `plugin/scripts/derive-touches-heuristic.ts`
- `plugin/scripts/touches-orthogonality-check.ts`
- `plugin/scripts/threshold-scope-check.ts`
- `plugin/scripts/tick-core-static-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-fs-walk-family.md`