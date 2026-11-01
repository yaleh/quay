---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-239
title: "freshness-refresh: margin 9 (d=191, evidence_ts 2026-10-22T12:00:12Z,
  age 242.31h) -> margin/K=0.045 <= threshold 0.0714: window would be exhausted
  by tip advance before a producer"
status: todo
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
margin 9 (d=191, evidence_ts 2026-10-22T12:00:12Z, age 242.31h) -> margin/K=0.045 <= threshold 0.0714: window would be exhausted by tip advance before a producer run finishes (AC-239 has no separate command; it refreshes with AC-238)

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1793542937322` · ts `2026-11-01T14:22:17.322Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-239`、`upgrade-face`
- 涉及文件：
- `plugin/freshness-producers.json`
- `.quay/goal-freshness-margin.json`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run upgrade-face on host B (same command as AC-238; --ac239-e2e leg refreshes AC-239)

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `GOAL-009-AC-239` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T14:22:17.322Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-239`（routine `freshness-refresh`，runId `freshness-refresh-1793542937322`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-239.md`