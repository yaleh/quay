---
id: gap-routine-semantic-dedup-scan-readjsonlines-seven-defs-three-behaviors
title: "semantic-dedup-scan: 7 private definitions, none imported, no canonical
  jsonl reader in gate-script-base.ts/checker-lib.ts/kernel; they collapse to 3
  runtime behaviors differing on"
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
7 private definitions, none imported, no canonical jsonl reader in gate-script-base.ts/checker-lib.ts/kernel; they collapse to 3 runtime behaviors differing on split(/\r?\n/) vs split("\n") and on the non-object guard, so a CRLF ledger yields different rows per caller and psi-failure-correlation-check.ts:96 already imports windowMeanStall from psi-window-join.ts (a live half-finished extraction).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790118332027` · ts `2026-09-22T23:05:32.027Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readJsonLines`
- 涉及文件：
- `plugin/scripts/obligation-ledger.ts:109`
- `plugin/scripts/obligation-ledger-check.ts:48`
- `plugin/scripts/psi-failure-correlation-check.ts:310`
- `plugin/scripts/psi-window-join.ts:53`
- `plugin/scripts/freshness-producer-coverage-check.ts:235`
- `plugin/scripts/ready-pool-check.ts:1596`
- `plugin/scripts/trend-check.ts:100`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `readjsonlines-seven-defs-three-behaviors`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790118332027`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/obligation-ledger.ts`
- `plugin/scripts/obligation-ledger-check.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/psi-window-join.ts`
- `plugin/scripts/freshness-producer-coverage-check.ts`
- `plugin/scripts/ready-pool-check.ts`
- `plugin/scripts/trend-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-readjsonlines-seven-defs-three-behaviors.md`