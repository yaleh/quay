---
id: gap-routine-semantic-dedup-scan-to-epoch-seconds-copied
title: "semantic-dedup-scan: Byte-identical Math.floor(Date.parse(iso)/1000),
  and the copier's own comment says it is 'the same conversion
  full-suite-runner.toEpochSeconds uses'; accountin"
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
Byte-identical Math.floor(Date.parse(iso)/1000), and the copier's own comment says it is 'the same conversion full-suite-runner.toEpochSeconds uses'; accounting-emit.ts:100 is a different, richer resolver and is not part of this cluster.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793162251891` · ts `2026-10-28T04:37:31.891Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`toEpochSeconds`
- 涉及文件：
- `plugin/scripts/full-suite-runner.ts:455`
- `plugin/scripts/mirror-full-suite-state.ts:50`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T04:37:31.891Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `to-epoch-seconds-copied`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793162251891`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/full-suite-runner.ts`
- `plugin/scripts/mirror-full-suite-state.ts`
- `tasks/gap-routine-semantic-dedup-scan-to-epoch-seconds-copied.md`