---
id: gap-routine-semantic-dedup-scan-release-branch-prefix
title: "semantic-dedup-scan: the globs-to-prefix derivation is exported by the
  declared release-model authority yet release-cut.mjs hand-copies it although
  it already spawns that module fo"
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
the globs-to-prefix derivation is exported by the declared release-model authority yet release-cut.mjs hand-copies it although it already spawns that module for --print-model

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793943196283` · ts `2026-11-06T05:33:16.283Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`releaseBranchPrefix`
- 涉及文件：
- `plugin/scripts/release-cut.mjs:355`
- `plugin/scripts/release-model-check.ts:182`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T05:33:16.283Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `release-branch-prefix`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793943196283`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/release-cut.mjs`
- `plugin/scripts/release-model-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-release-branch-prefix.md`