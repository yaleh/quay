---
id: gap-routine-semantic-dedup-scan-read-current-state-duplicate
title: "semantic-dedup-scan: byte-identical JSON.parse-or-null state reader
  declared twice; no shared readJsonOrNull helper exists in plugin/scripts"
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
byte-identical JSON.parse-or-null state reader declared twice; no shared readJsonOrNull helper exists in plugin/scripts

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791536153223` · ts `2026-10-09T08:55:53.223Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readCurrentState`、`readState`
- 涉及文件：
- `plugin/scripts/mirror-full-suite-state.ts:128`
- `plugin/scripts/red-window-triage.ts:159`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge into one shared readJsonOrNull

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `read-current-state-duplicate`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791536153223`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/mirror-full-suite-state.ts`
- `plugin/scripts/red-window-triage.ts`
- `tasks/gap-routine-semantic-dedup-scan-read-current-state-duplicate.md`