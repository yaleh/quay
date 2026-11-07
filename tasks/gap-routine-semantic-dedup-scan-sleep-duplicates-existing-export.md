---
id: gap-routine-semantic-dedup-scan-sleep-duplicates-existing-export
title: "semantic-dedup-scan: Three plugin copies are the same one-liner new
  Promise(r => setTimeout(r, ms)) while driver-runtime.ts:280 already EXPORTS
  the identical sleep, so they duplica"
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
Three plugin copies are the same one-liner new Promise(r => setTimeout(r, ms)) while driver-runtime.ts:280 already EXPORTS the identical sleep, so they duplicate an existing export rather than an absent one

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794036444725` · ts `2026-11-07T07:27:24.725Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`sleep`
- 涉及文件：
- `plugin/scripts/discovery-method-routine.ts:676`
- `plugin/scripts/psi-failure-correlation-check.ts:318`
- `plugin/scripts/suite-load-sampler.ts:45`
- `plugin/scripts/driver-runtime.ts:280`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-07T07:27:24.725Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `sleep-duplicates-existing-export`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794036444725`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/suite-load-sampler.ts`
- `plugin/scripts/driver-runtime.ts`
- `tasks/gap-routine-semantic-dedup-scan-sleep-duplicates-existing-export.md`