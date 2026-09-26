---
id: gap-routine-semantic-dedup-scan-seeded-prng-three-copies-two-names-reproducibili
title: "semantic-dedup-scan: three copies under two names; a literal-level
  comparison (not just comment-stripped) confirms the two cited bodies are
  identical INCLUDING every constant, and "
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
three copies under two names; a literal-level comparison (not just comment-stripped) confirms the two cited bodies are identical INCLUDING every constant, and an empirical 6-seed by 10000-draw comparison confirms the third is output-equivalent today, which is the reproducibility primitive cross-report seed comparability depends on

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790417424782` · ts `2026-09-26T10:10:24.782Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`mulberry32`、`makeRng`
- 涉及文件：
- `plugin/scripts/defect-latency-pair.ts:306`
- `plugin/scripts/discovery-path-classify.ts:424`
- `plugin/scripts/rework-predictors.ts:345`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract one seededRng and re-export it under both existing names so seeds stay comparable

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `seeded-prng-three-copies-two-names-reproducibility-primitive`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790417424782`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/defect-latency-pair.ts`
- `plugin/scripts/discovery-path-classify.ts`
- `plugin/scripts/rework-predictors.ts`
- `tasks/gap-routine-semantic-dedup-scan-seeded-prng-three-copies-two-names-reproducibili.md`