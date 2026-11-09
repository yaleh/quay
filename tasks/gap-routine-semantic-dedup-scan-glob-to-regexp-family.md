---
id: gap-routine-semantic-dedup-scan-glob-to-regexp-family
title: "semantic-dedup-scan: Four wildcard grammars: design supports ** and
  slash-scoped *, shipped-set omits **, release-model lets * cross '/', touches
  escapes '?' as a literal and lets "
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
Four wildcard grammars: design supports ** and slash-scoped *, shipped-set omits **, release-model lets * cross '/', touches escapes '?' as a literal and lets ** match zero directories — one parameterised builder could cover all behind 3-4 flags.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794222946369` · ts `2026-11-09T11:15:46.369Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`globToRegExp`
- 涉及文件：
- `plugin/scripts/design-evolution-readings.ts:206`
- `plugin/scripts/release-model-check.ts:165`
- `plugin/scripts/shipped-set-rules.ts:93`
- `plugin/scripts/touches-orthogonality-check.ts:123`
- kind：`same-symbol-multi-file`
- verdict：`divergent-implementation`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-09T11:15:46.369Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `glob-to-regexp-family`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794222946369`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/design-evolution-readings.ts`
- `plugin/scripts/release-model-check.ts`
- `plugin/scripts/shipped-set-rules.ts`
- `plugin/scripts/touches-orthogonality-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-glob-to-regexp-family.md`