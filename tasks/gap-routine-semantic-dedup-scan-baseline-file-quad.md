---
id: gap-routine-semantic-dedup-scan-baseline-file-quad
title: "semantic-dedup-scan: All four are byte-identical path.join(root,
  ...BASELINE_FILE_REL.split('/')); only each module's own BASELINE_FILE_REL
  constant varies and no shared leaf carri"
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
All four are byte-identical path.join(root, ...BASELINE_FILE_REL.split('/')); only each module's own BASELINE_FILE_REL constant varies and no shared leaf carries the helper.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791238550062` · ts `2026-10-05T22:15:50.062Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`baselineFile`
- 涉及文件：
- `plugin/scripts/host-repo-surface-ratchet.ts:222`
- `plugin/scripts/import-graph-check.ts:502`
- `plugin/scripts/quay-init-closure-ratchet.ts:230`
- `plugin/scripts/sh-census-check.ts:756`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract baselinePath(root, rel) into a shared leaf; each consumer passes its own constant

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `baseline-file-quad`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791238550062`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/host-repo-surface-ratchet.ts`
- `plugin/scripts/import-graph-check.ts`
- `plugin/scripts/quay-init-closure-ratchet.ts`
- `plugin/scripts/sh-census-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-baseline-file-quad.md`