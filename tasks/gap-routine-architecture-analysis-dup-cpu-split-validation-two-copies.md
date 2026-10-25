---
id: gap-routine-architecture-analysis-dup-cpu-split-validation-two-copies
title: "architecture-analysis: archguard exact-clone hash e903751a0cc007ae: a
  7-statement / 97-token / 10-line CPU-split admission rule is byte-identical
  (comments included) in two round-r"
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
archguard exact-clone hash e903751a0cc007ae: a 7-statement / 97-token / 10-line CPU-split admission rule is byte-identical (comments included) in two round-record checkers; recurrence of the 2026-10-24 finding, still unfiled, so a change to the fail-closed rule can land in one copy only.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792940968187` · ts `2026-10-25T15:09:28.187Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`hasRealSplit`
- 涉及文件：
- `plugin/scripts/per-task-suite-record.ts:227`
- `plugin/scripts/pre-verified-round-record.ts:677`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract the rule into plugin/scripts/cpu-split-contract.ts and have both round-record checkers import it; AC = archguard_detect_duplicates totalGroups for that hash returns 0.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-25T15:09:28.187Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-cpu-split-validation-two-copies`（routine `architecture-analysis`，runId `architecture-analysis-1792940968187`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/per-task-suite-record.ts`
- `plugin/scripts/pre-verified-round-record.ts`
- `tasks/gap-routine-architecture-analysis-dup-cpu-split-validation-two-copies.md`