---
id: gap-routine-architecture-analysis-god-package-plugin-scripts
title: "architecture-analysis: fanOut 3607 across 314 files / 4772 entities —
  flat scripts dir has outgrown one package; largest files are 4-7k lines
  (worker-driver 7155, full-suite-runner"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
fanOut 3607 across 314 files / 4772 entities — flat scripts dir has outgrown one package; largest files are 4-7k lines (worker-driver 7155, full-suite-runner 5866)

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793401956536` · ts `2026-10-30T23:12:36.536Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`withPerFileCpuPreload`、`isStaticCheckFailureLine`、`extractStaticCheckDetail`
- 涉及文件：
- `plugin/scripts/full-suite-runner.ts:239`
- `plugin/scripts/worker-driver.ts:1`
- kind：`god-package`
- verdict：`CONFIRMED`

## Requested action
group scripts by surface (driver/check/reading) into sub-packages and split megascripts at their natural seams

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-30T23:12:36.536Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-plugin-scripts`（routine `architecture-analysis`，runId `architecture-analysis-1793401956536`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/full-suite-runner.ts`
- `plugin/scripts/worker-driver.ts`
- `tasks/gap-routine-architecture-analysis-god-package-plugin-scripts.md`