---
id: gap-routine-semantic-dedup-scan-read-file-join-root-pair
title: "semantic-dedup-scan: Byte-identical `path.join(root,rel)` + `existsSync
  ? readFileSync : ''` under the same (root,rel) contract in two sibling
  checkers that both already import gat"
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
Byte-identical `path.join(root,rel)` + `existsSync ? readFileSync : ''` under the same (root,rel) contract in two sibling checkers that both already import gate-script-base.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792168649663` · ts `2026-10-16T16:37:29.663Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readFile`
- 涉及文件：
- `plugin/scripts/dual-source-check.ts:66`
- `plugin/scripts/retired-clause-check.ts:196`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract — one shared root-relative reader

## Disposition
**已修掉**（不是「已有机制在管」）。按 finding 的 `suggestedAction` 抽单一 root-relative 读取器
`readRootRel(root, rel)`（`= readFileSafe ∘ path.join`）落 `plugin/scripts/gate-script-base.ts`；两处具名私有
副本（`dual-source-check.ts` / `retired-clause-check.ts` 的 `readFile`）删除，改调共享读取器。两处调用点本来
就已 import `gate-script-base`，故无需新增依赖。

**⑤b 扫描**（同一原则在本载体的其它适用点）：命中 3 处**具名 helper** —— 除 finding 点名的 2 处外，第三个实例
`plugin/scripts/red-on-omission-audit.ts:43 readUnder`（标识符归一后与上两处逐字节相同，探针的两文件分组漏掉了
它）一并迁移，使该类闭合而非半闭合。扫描同时如实记录其**外延**（⛔ 不在本 finding 的类内）：
`ac61-staleness-disposition-check.ts:247` 是**内联**同型（不是 helper，属更宽的 read-or-empty 族，由各自
finding 处置）；`semantic-observer-judge.ts:235` 返回 `null`，是**不同契约**。

**语义**：与退役副本在其可被喂入的每个输入上相同；唯一分歧是「存在但不可读」（EACCES/EISDIR）——副本让
`readFileSync` 抛，共享读取器返回 `""`（`readFileSafe` 已文档化的 checker 约定）。两个调用点都把 `""` 当
**失败**信号消费（`dual-source-check` ⇒ DUAL-SOURCE；`retired-clause-check` ⇒ NOT-ARCHIVED），故不可能把真
问题变绿。

**可核证据（一条命令）**：`node --test plugin/test/gap-routine-semantic-dedup-scan-read-file-join-root-pair.test.mjs`
—— 5 测试：单一定义棘轮 +「全 `plugin/scripts` 零私有副本」+ 双向负控制（逐字退役体必判为私有副本；改名 /
箭头式 / 非同型必不判）+ 语义一致性。负控制已对**真前像**干跑：还原 `develop` 版 `dual-source-check.ts` 后棘轮
转红并点名 `dual-source-check.ts: readFile`。受影响既有测试 43/43 绿，`gate-script-base.test.mjs` 69/69 绿，
三个检查器端到端 exit 0。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `read-file-join-root-pair`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792168649663`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/dual-source-check.ts`
- `plugin/scripts/retired-clause-check.ts`
- `plugin/scripts/red-on-omission-audit.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/gap-routine-semantic-dedup-scan-read-file-join-root-pair.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-read-file-join-root-pair.md`

## Blocker

**2026-10-16T17:11:37.507Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: incomplete suite (592/592 files) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
