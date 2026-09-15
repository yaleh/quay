---
id: gap-routine-semantic-dedup-scan-firstargregion-stripshellcomments
title: "semantic-dedup-scan: Both pairs have identical algorithms —
  firstArgRegion differs only in parameter ORDER (283b vs 295b),
  stripShellComments only in brace layout (679b vs 777b); t"
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
Both pairs have identical algorithms — firstArgRegion differs only in parameter ORDER (283b vs 295b), stripShellComments only in brace layout (679b vs 777b); the size gaps that made them look diverged are formatting.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1789322638156` · ts `2026-09-13T18:03:58.156Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`firstArgRegion`、`stripShellComments`
- 涉及文件：
- `plugin/scripts/task-file-bypass-check.ts:126`
- `plugin/scripts/test-isolation-check.ts:537`
- `plugin/scripts/adr016-screen-use-check.ts:137`
- `plugin/scripts/dead-code-after-return-check.ts:78`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `firstargregion-stripshellcomments`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1789322638156`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/task-file-bypass-check.ts`
- `plugin/scripts/test-isolation-check.ts`
- `plugin/scripts/adr016-screen-use-check.ts`
- `plugin/scripts/dead-code-after-return-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-firstargregion-stripshellcomments.md`