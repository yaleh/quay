---
id: gap-routine-semantic-dedup-scan-baseline-shrink-only-copy
title: "semantic-dedup-scan: Both ratchet checkers define the same exported
  shrink-only judgment (head-null bootstrap, worktree-null, raised axes) with
  only the axis source differing (Obje"
status: todo
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Both ratchet checkers define the same exported shrink-only judgment (head-null bootstrap, worktree-null, raised axes) with only the axis source differing (Object.keys vs BASELINE_AXES).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792405443214` · ts `2026-10-19T10:24:03.214Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`checkBaselineShrinkOnly`
- 涉及文件：
- `plugin/scripts/import-graph-check.ts:478`
- `plugin/scripts/sh-census-check.ts:879`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `baseline-shrink-only-copy`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792405443214`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/import-graph-check.ts`
- `plugin/scripts/sh-census-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-baseline-shrink-only-copy.md`