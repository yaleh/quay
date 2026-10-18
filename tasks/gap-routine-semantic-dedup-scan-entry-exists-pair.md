---
id: gap-routine-semantic-dedup-scan-entry-exists-pair
title: "semantic-dedup-scan: Two private helpers in the same package with
  identical lstatSync bodies and the same dangling-symlink comment; nothing
  prevents a shared import and no test pin"
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
Two private helpers in the same package with identical lstatSync bodies and the same dangling-symlink comment; nothing prevents a shared import and no test pins the pair.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792287725786` · ts `2026-10-18T01:42:05.786Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`entryExists`
- 涉及文件：
- `packages/quay/src/goal-preview.ts:121`
- `packages/quay/src/worktree-deps.ts:44`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `entry-exists-pair`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792287725786`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/goal-preview.ts`
- `packages/quay/src/worktree-deps.ts`
- `tasks/gap-routine-semantic-dedup-scan-entry-exists-pair.md`