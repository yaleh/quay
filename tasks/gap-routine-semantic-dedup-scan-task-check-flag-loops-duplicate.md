---
id: gap-routine-semantic-dedup-scan-task-check-flag-loops-duplicate
title: "semantic-dedup-scan: near-identical flag-parsing loops
  (root/json/write-ratchet/allow-growth/reset-baseline/strict-subset/no-block/f\
  iles) in the two task checkers — a separate real"
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
near-identical flag-parsing loops (root/json/write-ratchet/allow-growth/reset-baseline/strict-subset/no-block/files) in the two task checkers — a separate real duplication discovered while dismissing the runCli name collision

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791536153223` · ts `2026-10-09T08:55:53.223Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`runCli`
- 涉及文件：
- `plugin/scripts/task-ac-carryover-check.ts:336`
- `plugin/scripts/task-contract-check.ts:544`
- kind：`divergent-implementation`
- verdict：`real-duplication`

## Requested action
extract the shared flag loop (and fold onto gate-script-base.parseArgs)

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `task-check-flag-loops-duplicate`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791536153223`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/task-ac-carryover-check.ts`
- `plugin/scripts/task-contract-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-task-check-flag-loops-duplicate.md`