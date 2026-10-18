---
id: gap-routine-semantic-dedup-scan-append-evidence-pair
title: "semantic-dedup-scan: Identical best-effort mkdir-plus-appendFileSync
  JSONL body under the same exported name in two sibling probe scripts,
  differing by one word in a catch comment."
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
Identical best-effort mkdir-plus-appendFileSync JSONL body under the same exported name in two sibling probe scripts, differing by one word in a catch comment.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792287725786` · ts `2026-10-18T01:42:05.786Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`appendEvidence`
- 涉及文件：
- `plugin/scripts/channel-probe-server.ts:149`
- `plugin/scripts/peer-identity-probe.ts:305`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `append-evidence-pair`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792287725786`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Disposition（复核与处置）

**结论：修掉（`merge` 已落地）。** 量法与读数如下，全部可在 worktree 里重跑。

### 1. 复核（用探针自己 §① 的机械步）
谓词 = 取每个 `function` 声明体、去注释与空白、做归一化摘要后按 `(名字, 摘要)` 分组。

```
修复前（`git show develop:` 的两份拷贝）
DUPLICATE appendEvidence:242b8416d0d4 -> channel-probe-server.ts:149 | peer-identity-probe.ts:305
scanned_files=2 functions=37 duplicate_groups=1

修复后（worktree，含 gate-script-base.ts）
scanned_files=3 functions=62 duplicate_groups=0
```

**零计数的负控制（硬规则 2）**：同一脚本、同一谓词先在修复前的两份拷贝上跑，命中的正是 finding 点名的那一对
⇒ 修复后的 `0` 是测量结果，不是读不懂输入的盲仪器。

全量旁证：对 `plugin/scripts/*.ts` 全量跑同一扫描，`appendJsonlLine` / `appendEvidence` 均不再出现在任何重复组里。

### 2. 处置
- 唯一实现 = `plugin/scripts/gate-script-base.ts` 的 `appendJsonlLine(file, entry)`（与已有 `readJsonLines` 读侧成对）。
  **契约逐字保留**：best-effort、写失败吞掉、绝不抛出 —— 两个调用方都是长跑探针，证据文件是诊断性的，
  探针因证据目录不可写而死会连同「探针在跑」这个事实一起消失。注释里写明这是契约而非疏忽。
- `channel-probe-server.ts` 保留历史导出名 `appendEvidence`（其测试按该名 import），实现变成一行委托。
- `peer-identity-probe.ts` 删除本地 `appendEvidence`，10 个调用点直接调共享叶子。
  **刻意不留同形单行适配器**：两份「同名 + 同体」的适配器仍会被判重扫描按同一谓词重新立案
  （`appendEvidence` 这一对在近六轮 finding 里反复出现），而本文件没有任何外部消费者按该名引用。

### 3. 测试
`plugin/test/channel-probe-server.test.mjs` + `plugin/test/peer-identity-probe.test.mjs` +
`plugin/test/gate-script-base.test.mjs`：104 tests / 104 pass / 0 fail。

## Touches
- `plugin/scripts/channel-probe-server.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/peer-identity-probe.ts`
- `tasks/gap-routine-semantic-dedup-scan-append-evidence-pair.md`