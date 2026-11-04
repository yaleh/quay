---
id: gap-routine-architecture-analysis-god-package-plugin-scripts-flat-317-files
title: "architecture-analysis: single flat directory holds the entire
  methodology script surface; largest entity cluster in the repo"
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
single flat directory holds the entire methodology script surface; largest entity cluster in the repo

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793780643192` · ts `2026-11-04T08:24:03.192Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`takeLdFileReading`、`readDirectoryCycleReading`
- 涉及文件：
- `plugin/scripts/phase-declare.ts:443`
- `plugin/scripts/archguard-runner.ts:1`
- kind：`god-package`
- verdict：`god-package: 4784 entities / 317 files, fanOut=3630 (repo max)`

## Requested action
group scripts into role subdirs (orchestration/, probes/, driver/, checks/)

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T08:24:03.192Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-plugin-scripts-flat-317-files`（routine `architecture-analysis`，runId `architecture-analysis-1793780643192`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/phase-declare.ts`
- `plugin/scripts/archguard-runner.ts`
- `tasks/gap-routine-architecture-analysis-god-package-plugin-scripts-flat-317-files.md`