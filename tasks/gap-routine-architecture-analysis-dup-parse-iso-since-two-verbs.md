---
id: gap-routine-architecture-analysis-dup-parse-iso-since-two-verbs
title: "architecture-analysis: archguard exact-clone 82266722a040a86e (101
  tokens / 7 statements / 11 lines): the two verbs' --since validators differ
  only in the error-message prefix; the"
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
archguard exact-clone 82266722a040a86e (101 tokens / 7 statements / 11 lines): the two verbs' --since validators differ only in the error-message prefix; the in-code note says the copy exists so each verb keeps its own wording, but a parseIsoSince(raw, verbLabel) helper reproduces both strings byte-for-byte, so the stated reason does not actually require duplication.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793051973088` · ts `2026-10-26T21:59:33.088Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseDriverLogSince`、`parseSuiteSince`
- 涉及文件：
- `packages/quay/src/cli/driver.ts:221`
- `packages/quay/src/cli/suite.ts:104`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one parseIsoSince(raw, verbLabel) into a shared cli helper and have both verbs call it with 'quay driver log' / 'quay suite'; AC = the existing cli tests asserting each verb's exact --since error text pass unchanged, and archguard no longer returns group 82266722a040a86e for scope 075f2c0c.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T21:59:33.088Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-parse-iso-since-two-verbs`（routine `architecture-analysis`，runId `architecture-analysis-1793051973088`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/cli/driver.ts`
- `packages/quay/src/cli/suite.ts`
- `tasks/gap-routine-architecture-analysis-dup-parse-iso-since-two-verbs.md`