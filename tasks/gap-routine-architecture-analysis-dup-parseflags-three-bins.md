---
id: gap-routine-architecture-analysis-dup-parseflags-three-bins
title: "architecture-analysis: Three byte-identical 20-line --flag/positional
  parsers (archguard dup hash 0894cf83d4e2ca49, 174 tokens) across the three
  provider CLI bins, so --flag=value "
status: todo
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
Three byte-identical 20-line --flag/positional parsers (archguard dup hash 0894cf83d4e2ca49, 174 tokens) across the three provider CLI bins, so --flag=value or bool semantics changes need three edits.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792481915389` · ts `2026-10-20T07:38:35.389Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseFlags`
- 涉及文件：
- `packages/quay-backlog/bin/quay-backlog.ts:23`
- `packages/quay-github/bin/quay-github.ts:33`
- `packages/quay-native/bin/quay-native.ts:83`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one parseFlags into a shared bin util and import it from all three bins; AC: one definition under `git grep -n 'function parseFlags'` and three bin smoke tests (`--help`) stay green.

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-parseflags-three-bins`（routine `architecture-analysis`，runId `architecture-analysis-1792481915389`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay-backlog/bin/quay-backlog.ts`
- `packages/quay-github/bin/quay-github.ts`
- `packages/quay-native/bin/quay-native.ts`
- `tasks/gap-routine-architecture-analysis-dup-parseflags-three-bins.md`