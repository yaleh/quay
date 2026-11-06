---
id: gap-routine-semantic-dedup-scan-discovery-config-reader-template
title: "semantic-dedup-scan: the three readers are one 1154-char template
  differing only in the loop key and parse callee, and each of the three
  routines carries about six more near-identi"
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
the three readers are one 1154-char template differing only in the loop key and parse callee, and each of the three routines carries about six more near-identical scaffold functions while their run cores genuinely differ

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793943196283` · ts `2026-11-06T05:33:16.283Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readArchDiscoveryConfig`、`readDiscoveryMethodConfig`、`readOpenSemanticDiscoveryConfig`
- 涉及文件：
- `plugin/scripts/arch-discovery-routine.ts:320`
- `plugin/scripts/discovery-method-routine.ts:490`
- `plugin/scripts/open-semantic-discovery-routine.ts:851`
- kind：`other`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T05:33:16.283Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `discovery-config-reader-template`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793943196283`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/arch-discovery-routine.ts`
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/scripts/open-semantic-discovery-routine.ts`
- `tasks/gap-routine-semantic-dedup-scan-discovery-config-reader-template.md`