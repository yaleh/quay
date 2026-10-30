---
id: gap-routine-architecture-analysis-dup-release-yml-parsers
title: "architecture-analysis: two adjacent 6-statement functions differ only in
  the regex pattern — duplicated parse-release.yml extraction in the same file"
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
two adjacent 6-statement functions differ only in the regex pattern — duplicated parse-release.yml extraction in the same file

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793401956536` · ts `2026-10-30T23:12:36.536Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseReleaseYmlNpmTarballs`、`parseReleaseYmlSeaBinaries`
- 涉及文件：
- `scripts/delivery-manifest-check.ts:83`
- `scripts/delivery-manifest-check.ts:95`
- kind：`duplication`
- verdict：`CONFIRMED`

## Requested action
merge into one parameterized parseReleaseYmlPackages(yml, regex) helper

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-30T23:12:36.536Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-release-yml-parsers`（routine `architecture-analysis`，runId `architecture-analysis-1793401956536`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `scripts/delivery-manifest-check.ts`
- `scripts/delivery-manifest-check.test.ts`
- `tasks/gap-routine-architecture-analysis-dup-release-yml-parsers.md`

## ADR-007 暗轴记录
该轴仍暗,理由:本任务合并两个仅 regex 不同的解析函数为单一参数化 helper,未运行 archguard L_D/L_G 仪器取数值读数
