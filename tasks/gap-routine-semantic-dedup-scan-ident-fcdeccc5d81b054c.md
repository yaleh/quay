---
id: gap-routine-semantic-dedup-scan-ident-fcdeccc5d81b054c
title: "semantic-dedup-scan: Identical execSync git args inline wrapper with
  same cwd/encoding/timeout, explicitly annotated same shape as
  build-evidence-gate.ts."
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
Identical execSync git args inline wrapper with same cwd/encoding/timeout, explicitly annotated same shape as build-evidence-gate.ts.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791142275270` · ts `2026-10-04T19:31:15.270Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`git`
- 涉及文件：
- `plugin/scripts/run-identity.ts:98`
- `plugin/scripts/stage-receipt.ts:245`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `ident-fcdeccc5d81b054c`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791142275270`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/run-identity.ts`
- `plugin/scripts/stage-receipt.ts`
- `tasks/gap-routine-semantic-dedup-scan-ident-fcdeccc5d81b054c.md`