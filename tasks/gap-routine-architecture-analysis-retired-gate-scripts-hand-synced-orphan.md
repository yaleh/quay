---
id: gap-routine-architecture-analysis-retired-gate-scripts-hand-synced-orphan
title: "architecture-analysis: plugin/README.md:77-84 declares
  plugin/gate-scripts RETIRED and 'no longer synced by sync.sh', yet both files
  are md5-identical to the live experiments copie"
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
plugin/README.md:77-84 declares plugin/gate-scripts RETIRED and 'no longer synced by sync.sh', yet both files are md5-identical to the live experiments copies (12c73e9c…, 1651758…) and commit 21f292911 added 124 lines to BOTH by hand; the only drift checker (workflows-dual-copy-drift-check) was archived 2026-09-07 and sync-vendor.sh has zero gate-scripts references, so a one-sided edit can no longer be caught.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793162787359` · ts `2026-10-28T04:46:27.359Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`main`、`dueDirectives`、`parseDisposition`、`classifyDirective`、`checkBodyIntegrity`、`countRealNewlines`
- 涉及文件：
- `plugin/gate-scripts/drain-scheduler.ts:1`
- `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts:1`
- `plugin/gate-scripts/drain-dispose-corruption-check.ts:1`
- `experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts:1`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Delete plugin/gate-scripts/ (retired and undistributed) or, if retention is required, add it to a sync script and ship a live byte-identity check across all four copies.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T04:46:27.359Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `retired-gate-scripts-hand-synced-orphan`（routine `architecture-analysis`，runId `architecture-analysis-1793162787359`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/gate-scripts/drain-scheduler.ts`
- `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts`
- `plugin/gate-scripts/drain-dispose-corruption-check.ts`
- `experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts`
- `tasks/gap-routine-architecture-analysis-retired-gate-scripts-hand-synced-orphan.md`