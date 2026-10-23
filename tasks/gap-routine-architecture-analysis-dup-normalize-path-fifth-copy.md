---
id: gap-routine-architecture-analysis-dup-normalize-path-fifth-copy
title: "architecture-analysis: archguard dup hash e964e05c0cd10901: the 10-line
  dot-segment net-path normalizer exists twice byte-identically (2
  implementations repo-wide, `grep -rn 'seg ="
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
archguard dup hash e964e05c0cd10901: the 10-line dot-segment net-path normalizer exists twice byte-identically (2 implementations repo-wide, `grep -rn 'seg === "\.\."'` → exactly these two); gap-b3 unified 4 prior copies into gate-script-base.normalizeRel but the touches-orthogonality-check sibling survived even though that file already imports gate-script-base (line 20) — the 硬规则 5b shape.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792752934532` · ts `2026-10-23T10:55:34.532Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`normalizeRel`、`normalizePath`
- 涉及文件：
- `plugin/scripts/gate-script-base.ts:553`
- `plugin/scripts/touches-orthogonality-check.ts:46`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Import normalizeRel from gate-script-base.ts in touches-orthogonality-check.ts and delete normalizePath (5-line diff, one import edge already exists).

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-23T10:55:34.532Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-normalize-path-fifth-copy`（routine `architecture-analysis`，runId `architecture-analysis-1792752934532`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/touches-orthogonality-check.ts`
- `tasks/gap-routine-architecture-analysis-dup-normalize-path-fifth-copy.md`