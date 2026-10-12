---
id: gap-routine-semantic-dedup-scan-runner-grouping-groupof-copy
title: "semantic-dedup-scan: normalized bodies are byte-identical (18 tokens)
  across a .mjs and a .ts that already share a filename stem — one
  suite-grouping classifier implemented twice o"
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
normalized bodies are byte-identical (18 tokens) across a .mjs and a .ts that already share a filename stem — one suite-grouping classifier implemented twice on two module dialects.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791821278116` · ts `2026-10-12T16:07:58.116Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`groupOf`
- 涉及文件：
- `plugin/scripts/runner-grouping-metadata.mjs:31`
- `plugin/scripts/runner-grouping.ts:53`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge — one implementation, imported by the other (TS imports .mjs fine)

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `runner-grouping-groupof-copy`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791821278116`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/runner-grouping-metadata.mjs`
- `plugin/scripts/runner-grouping.ts`
- `tasks/gap-routine-semantic-dedup-scan-runner-grouping-groupof-copy.md`