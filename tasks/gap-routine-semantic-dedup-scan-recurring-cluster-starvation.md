---
id: gap-routine-semantic-dedup-scan-recurring-cluster-starvation
title: "semantic-dedup-scan: 264 candidate findings rejected vs 6 tasks filed
  across 3 rounds (DEFAULT_RATE=3); the highest-recurrence clusters have NO task
  at all — grep of tasks/*.md ret"
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
264 candidate findings rejected vs 6 tasks filed across 3 rounds (DEFAULT_RATE=3); the highest-recurrence clusters have NO task at all — grep of tasks/*.md returns 0 files for readServerCarrier, resolveCliPath, readJsonLines — while manifest.ts has been re-reported in all 6 rounds and the server-verify pair in 5, and the code is still duplicated today (verified byte-identical).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790118332027` · ts `2026-09-22T23:05:32.027Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`DEFAULT_RATE`、`gateFinding`
- 涉及文件：
- `plugin/scripts/routine-file-gate.ts:16`
- `plugin/scripts/routine-file-gate.ts:46`
- `.quay/routine-findings.jsonl`
- kind：`other`
- verdict：`real-duplication`

## Requested action
prioritize by recurrence count rather than re-discovering the same clusters each round

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `recurring-cluster-starvation`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790118332027`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/routine-file-gate.ts`
- `tasks/gap-routine-semantic-dedup-scan-recurring-cluster-starvation.md`