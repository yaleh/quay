---
id: gap-routine-semantic-dedup-scan-jsonl-batch-appenders
title: "semantic-dedup-scan: Four batch appenders are byte-identical modulo
  parameter name (ensure dir, map JSON.stringify+newline, one appendFileSync,
  return count) with a fifth near-vari"
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
Four batch appenders are byte-identical modulo parameter name (ensure dir, map JSON.stringify+newline, one appendFileSync, return count) with a fifth near-variant; gate-script-base appendJsonlLine is the single-record sibling whose best-effort void contract these return-count callers need beside it.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792940684375` · ts `2026-10-25T15:04:44.375Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`appendCarrierRecords`、`appendLedgerRecords`、`appendRoutineFindings`
- 涉及文件：
- `plugin/scripts/arch-discovery-routine.ts:376`
- `plugin/scripts/discovery-method-routine.ts:538`
- `plugin/scripts/discovery-method-routine.ts:641`
- `plugin/scripts/probe-routine.ts:758`
- `plugin/scripts/resource-anomaly-detector.ts:463`
- `plugin/scripts/gate-script-base.ts:564`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-25T15:04:44.375Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `jsonl-batch-appenders`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792940684375`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/arch-discovery-routine.ts`
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/scripts/probe-routine.ts`
- `plugin/scripts/resource-anomaly-detector.ts`
- `plugin/scripts/gate-script-base.ts`
- `tasks/gap-routine-semantic-dedup-scan-jsonl-batch-appenders.md`