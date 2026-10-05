---
id: gap-routine-semantic-dedup-scan-baseline-file-quad
title: "semantic-dedup-scan: All four are byte-identical path.join(root,
  ...BASELINE_FILE_REL.split('/')); only each module's own BASELINE_FILE_REL
  constant varies and no shared leaf carri"
status: done
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

## Disposition
**修掉（fixed）** —— 按 Requested action 逐字执行，落在 commit `b85c01311`（task 分支
`task/gap-routine-semantic-dedup-scan-baseline-file-quad`）。

- 共享叶 = `plugin/scripts/ratchet-baseline.ts`（本仓库 shrink-only ratchet baseline 的既有正本，
  由姊妹 finding `baseline-reader-septuplication` 建），新增 `export function baselinePath(root, rel)`。
- 四个消费者各自的 `baselineFile(root)` 仍是它们自己的**公开名**（`precommit-guard.ts` 与
  `import-graph-check.test.mjs` 都 import 它），体内改为一行 `return baselinePath(root, BASELINE_FILE_REL);`
  —— **推导共享、常量留在调用点**（与姊妹 reader/writer 抽取同一分工）。
- 可核（本轮实跑，非断言）：`grep -c 'path\.join(root, \.\.\.BASELINE_FILE_REL\.split("/"))'`
  在四个文件各为 **0**；`baselinePath` 在共享叶**恰 1** 处；四个 `return baselinePath(root, BASELINE_FILE_REL);` 各 1 处。
- 行为不变是**证过**的：四个 `baselineFile(root)` 对本模块真实常量返回的字符串与抽取前
  `path.join(root, ...REL.split("/"))` **逐字节相同**；四个消费者各自的测试 + `ratchet-baseline.test.mjs`
  直接单测全绿。

硬规则 5b（修的是共享源，不是一份拷贝）：全 `plugin/scripts` grep 同一推导 `path.join(root, ...<REL>.split("/"))` 共 **9 处**。
已修上面 4 处；**记录在案、未静默丢弃**的其余 5 处（前 3 条按 5b 产物要求列出）：
1. `plugin/scripts/criterion-failure-attribution-check.ts:238` —— `override ?? …` 变体，且它自己的**公开导出就叫**
   `baselinePath(root, override?)`；并入需先给公开导出改名，是另一次改动、另有一圈爆炸半径。
2. `plugin/scripts/sh-census-check.ts:621` `exceptionsFile`（`EXCEPTIONS_FILE_REL`）—— 同一推导，但**不是 baseline 文件**。
3. `plugin/scripts/host-repo-surface-ratchet.ts:120` `CLI_ENTRY_REL`（`CONFIG_KEY_CHECKER_REL` 见 :153 同形）。
   这三类要的是一个叫 `rootedPath` 的**通用**叶函数；塞进名为 `baselinePath` 的符号是一句命名谎言 ——
   它是比本 finding 更大、且属于另一个概念的另一笔改动。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `baseline-file-quad`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791238550062`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Test-Files
- `plugin/test/ratchet-baseline.test.mjs`

## Touches
- `plugin/scripts/ratchet-baseline.ts`
- `plugin/scripts/host-repo-surface-ratchet.ts`
- `plugin/scripts/import-graph-check.ts`
- `plugin/scripts/quay-init-closure-ratchet.ts`
- `plugin/scripts/sh-census-check.ts`
- `plugin/test/ratchet-baseline.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-baseline-file-quad.md`
