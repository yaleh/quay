---
id: gap-routine-semantic-dedup-scan-write-state-atomic-split
title: "semantic-dedup-scan: Five writeState helpers: two re-implement the
  tmp+rename atomic idiom inline while red-window-triage/runner-state-write
  already delegate to kernel writeJsonAto"
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
Five writeState helpers: two re-implement the tmp+rename atomic idiom inline while red-window-triage/runner-state-write already delegate to kernel writeJsonAtomic and meta-driver does a plain (non-atomic, torn-read-prone) writeFileSync — one behaviour with three implementations.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792940684375` · ts `2026-10-25T15:04:44.375Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`writeState`、`writeJsonAtomic`
- 涉及文件：
- `plugin/scripts/ci-runs-collect.ts:1226`
- `plugin/scripts/driver-anchor.ts:583`
- `plugin/scripts/meta-driver.ts:1558`
- `plugin/scripts/red-window-triage.ts:160`
- `plugin/scripts/runner-state-write.ts:55`
- `packages/quay/src/kernel/write-json-atomic.ts:45`
- kind：`divergent-implementation`
- verdict：`real-duplication`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-25T15:04:44.375Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `write-state-atomic-split`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792940684375`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/ci-runs-collect.ts`
- `plugin/scripts/driver-anchor.ts`
- `plugin/scripts/meta-driver.ts`
- `plugin/scripts/red-window-triage.ts`
- `plugin/scripts/runner-state-write.ts`
- `packages/quay/src/kernel/write-json-atomic.ts`
- `tasks/gap-routine-semantic-dedup-scan-write-state-atomic-split.md`