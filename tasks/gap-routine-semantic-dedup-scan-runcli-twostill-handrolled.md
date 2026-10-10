---
id: gap-routine-semantic-dedup-scan-runcli-twostill-handrolled
title: "semantic-dedup-scan: Two members delegate to shared parseArgs; two still
  hand-roll the same --root/--json/--help loop."
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
Two members delegate to shared parseArgs; two still hand-roll the same --root/--json/--help loop.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791631645924` · ts `2026-10-10T11:27:25.924Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`runCli`
- 涉及文件：
- `plugin/scripts/task-ac-carryover-check.ts:333`
- `plugin/scripts/task-contract-check.ts:533`
- `plugin/scripts/threshold-scope-check.ts:409`
- `plugin/scripts/tmux-test-isolation-check.ts:100`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
unify

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `runcli-twostill-handrolled`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791631645924`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/task-ac-carryover-check.ts`
- `plugin/scripts/task-contract-check.ts`
- `plugin/scripts/threshold-scope-check.ts`
- `plugin/scripts/tmux-test-isolation-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-runcli-twostill-handrolled.md`