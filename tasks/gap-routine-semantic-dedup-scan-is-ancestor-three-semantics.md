---
id: gap-routine-semantic-dedup-scan-is-ancestor-three-semantics
title: "semantic-dedup-scan: The same git ancestry question returns three
  different value sets in Core (tri-state true/false/null vs
  fold-all-errors-to-false fail-open vs 10s-timeout false"
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
The same git ancestry question returns three different value sets in Core (tri-state true/false/null vs fold-all-errors-to-false fail-open vs 10s-timeout false), while plugin/scripts already consolidated onto the tri-state `ancestry`.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793162251891` · ts `2026-10-28T04:37:31.891Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`isAncestor`、`ancestry`
- 涉及文件：
- `packages/quay/src/core/branch-model.ts:205`
- `packages/quay/src/goal-merge.ts:77`
- `packages/quay/src/observation.ts:556`
- `plugin/scripts/git-runner.ts:109`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T04:37:31.891Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `is-ancestor-three-semantics`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793162251891`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/core/branch-model.ts`
- `packages/quay/src/goal-merge.ts`
- `packages/quay/src/observation.ts`
- `plugin/scripts/git-runner.ts`
- `tasks/gap-routine-semantic-dedup-scan-is-ancestor-three-semantics.md`