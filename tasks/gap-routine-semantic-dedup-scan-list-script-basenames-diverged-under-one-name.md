---
id: gap-routine-semantic-dedup-scan-list-script-basenames-diverged-under-one-name
title: "semantic-dedup-scan: Identical bodies under one name, but one filters on
  EXEC_EXTENSIONS (.ts .sh .mjs .js .cjs .bash) and the other on
  SCRIPT_EXTENSIONS (.ts .sh .mjs), so the two"
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
Identical bodies under one name, but one filters on EXEC_EXTENSIONS (.ts .sh .mjs .js .cjs .bash) and the other on SCRIPT_EXTENSIONS (.ts .sh .mjs), so the two same-named enumerators return different sets and any consumer swapping them silently loses .js/.cjs/.bash scripts.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792033478766` · ts `2026-10-15T03:04:38.766Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`listScriptBasenames`
- 涉及文件：
- `plugin/scripts/outer-retirement-precondition-check.ts:112`
- `plugin/scripts/registry-bare-filename-scan.ts:200`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `list-script-basenames-diverged-under-one-name`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792033478766`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/outer-retirement-precondition-check.ts`
- `plugin/scripts/registry-bare-filename-scan.ts`
- `tasks/gap-routine-semantic-dedup-scan-list-script-basenames-diverged-under-one-name.md`