---
id: gap-routine-semantic-dedup-scan-hand-rolled-directory-walkers
title: "semantic-dedup-scan: Twelve hand-rolled readdirSync walkers; none
  imports fs-walk.ts walkFiles although the traversal skeleton is the same."
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
Twelve hand-rolled readdirSync walkers; none imports fs-walk.ts walkFiles although the traversal skeleton is the same.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794127147981` · ts `2026-11-08T08:39:07.981Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`walk`、`walkFiles`
- 涉及文件：
- `plugin/scripts/fs-walk.ts:187`
- `plugin/scripts/capability-catalog.ts:225`
- `plugin/scripts/crystallization-half-life.ts:338`
- `plugin/scripts/driver-runtime.ts:2057`
- `plugin/scripts/fan-in-materialize-check.ts:340`
- `plugin/scripts/freshness-producer-coverage-check.ts:589`
- `plugin/scripts/profiles-role-coverage-check.ts:183`
- `plugin/scripts/task-file-bypass-check.ts:217`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
merge onto fs-walk.ts with per-caller skip/depth options

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T08:39:07.981Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `hand-rolled-directory-walkers`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794127147981`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/fs-walk.ts`
- `plugin/scripts/capability-catalog.ts`
- `plugin/scripts/crystallization-half-life.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/fan-in-materialize-check.ts`
- `plugin/scripts/freshness-producer-coverage-check.ts`
- `plugin/scripts/profiles-role-coverage-check.ts`
- `plugin/scripts/task-file-bypass-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-hand-rolled-directory-walkers.md`