---
id: gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre
title: 'semantic-dedup-scan: All 12 bodies byte-identical
  (`s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`) under THREE names (escapeRe x3,
  escapeRegex x2, escapeRegExp x7); store.ts:116 docume'
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
All 12 bodies byte-identical (`s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`) under THREE names (escapeRe x3, escapeRegex x2, escapeRegExp x7); store.ts:116 documents itself as 'Mirrors ready-pool-check.ts's own escapeRegExp (same byte semantics  …

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790028867335` · ts `2026-09-21T22:14:27.335Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`escapeRe`、`escapeRegex`、`escapeRegExp`、`fnDefRe`、`stemRe`
- 涉及文件：
- `plugin/scripts/agent-panel-classify.ts:69`
- `plugin/scripts/deletion-closure-check.ts:66`
- `plugin/scripts/enum-surface-parity-check.ts:514`
- `plugin/scripts/identity-replication-check.ts:167`
- `plugin/scripts/manager-observation-runtime-check.ts:161`
- `plugin/scripts/prod-data-audit.ts:98`
- `plugin/scripts/ready-pool-check.ts:714`
- `plugin/scripts/repo-root-derivation-check.ts:64`
- `plugin/scripts/rhythm-consumer-check.ts:327`
- `plugin/scripts/task-ops.ts:76`
- `plugin/scripts/worker-driver.ts:635`
- `packages/quay-native/src/store.ts:116`
- `plugin/scripts/checker-count-drift-check.ts:70`
- `plugin/scripts/deletion-closure-check.ts:77`
- `plugin/scripts/deletion-closure-check.ts:68`
- `plugin/scripts/identity-replication-check.ts:169`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `escapere-escaperegex-escaperegexp-fndefre-stemre-escaperegex`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790028867335`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/agent-panel-classify.ts`
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/enum-surface-parity-check.ts`
- `plugin/scripts/identity-replication-check.ts`
- `plugin/scripts/manager-observation-runtime-check.ts`
- `plugin/scripts/prod-data-audit.ts`
- `plugin/scripts/ready-pool-check.ts`
- `plugin/scripts/repo-root-derivation-check.ts`
- `plugin/scripts/rhythm-consumer-check.ts`
- `plugin/scripts/task-ops.ts`
- `plugin/scripts/worker-driver.ts`
- `packages/quay-native/src/store.ts`
- `plugin/scripts/checker-count-drift-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre.md`