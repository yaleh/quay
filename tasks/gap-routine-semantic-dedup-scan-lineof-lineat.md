---
id: gap-routine-semantic-dedup-scan-lineof-lineat
title: "semantic-dedup-scan: Five identical 1-based newline-count bodies split
  across two names (lineOf x2, lineAt x3) — the rename signal; repo-wide there
  are 10 copies including a PRIVAT"
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
Five identical 1-based newline-count bodies split across two names (lineOf x2, lineAt x3) — the rename signal; repo-wide there are 10 copies including a PRIVATE unexported copy at checker-lib.ts:113 inside the very module that already exports code-position primitives, and the family repeats with snippetOf/snippetAt x5 and relOf x2, none e …

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790028867335` · ts `2026-09-21T22:14:27.335Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`lineOf`、`lineAt`
- 涉及文件：
- `plugin/scripts/deletion-closure-check.ts:121`
- `plugin/scripts/identity-replication-check.ts:149`
- `plugin/scripts/import-graph-check.ts:162`
- `plugin/scripts/sh-census-check.ts:296`
- `plugin/scripts/test-isolation-check.ts:136`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `lineof-lineat`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790028867335`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/identity-replication-check.ts`
- `plugin/scripts/import-graph-check.ts`
- `plugin/scripts/sh-census-check.ts`
- `plugin/scripts/test-isolation-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-lineof-lineat.md`