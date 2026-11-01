---
id: gap-routine-semantic-dedup-scan-b1
title: "semantic-dedup-scan: Seven named wrappers across six files all reduce to
  the same 1-2 line createHash('sha256') body; ~30 repo-wide call sites."
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
Seven named wrappers across six files all reduce to the same 1-2 line createHash('sha256') body; ~30 repo-wide call sites.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793491958069` · ts `2026-11-01T00:12:38.069Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`sha256Hex`、`sha256`、`sha256OfString`、`sha256OfBuffer`
- 涉及文件：
- `plugin/scripts/experiment-manifest.ts:175`
- `plugin/scripts/proposal-convergence.ts:37`
- `plugin/scripts/execution-policy.ts:124`
- `plugin/scripts/stage-receipt.ts:206`
- `plugin/scripts/stage-receipt.ts:210`
- `plugin/scripts/run-identity.ts:92`
- `plugin/scripts/primitives-drift-check.ts:71`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T00:12:38.069Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `B1`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793491958069`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/experiment-manifest.ts`
- `plugin/scripts/proposal-convergence.ts`
- `plugin/scripts/execution-policy.ts`
- `plugin/scripts/stage-receipt.ts`
- `plugin/scripts/run-identity.ts`
- `plugin/scripts/primitives-drift-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-b1.md`