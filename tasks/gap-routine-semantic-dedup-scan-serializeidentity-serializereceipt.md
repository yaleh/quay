---
id: gap-routine-semantic-dedup-scan-serializeidentity-serializereceipt
title: "semantic-dedup-scan: Character-identical canonical-JSON serializer
  (sorted keys, one nesting level) under two names."
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
Character-identical canonical-JSON serializer (sorted keys, one nesting level) under two names.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791631645924` · ts `2026-10-10T11:27:25.924Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`serializeIdentity`、`serializeReceipt`
- 涉及文件：
- `plugin/scripts/run-identity.ts:287`
- `plugin/scripts/stage-receipt.ts:226`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Disposition

**结论：修掉（不是「已有机制在管」）。** 现在只有一个实现：`plugin/scripts/gate-script-base.ts` 的
`serializeSortedJson`。finding 点名的两个函数保留原名并降为一行委托——它们是各自模块的公开面
（`workflow-journal.ts` 与 receipt 的 `contentHash` 寻址 `serializeReceipt`，C8 用例寻址
`serializeIdentity`），删名会改公开面，改的只是「实现有几份」。

落点沿用同族先例：`flagValue` / `git` / `gitLastCommitForPath` 三次提取都落在 `gate-script-base.ts`，
两个调用方本来就已经 import 它 —— ⛔ 不新造文件。

### 范围：finding 点名 2 个，实修 3 个（硬规则 5b 的载体扫描）

按 CLAUDE.md 硬规则 5b，修完被报的实例后在同一载体（「两级 sorted-copy 函数体」）里扫其余适用点，命中第三个：
`execution-policy.ts` 的 `bindPolicyHash` 内联了同一段函数体（只是内层 `for` 没有花括号、变量名不同）。
它一并折叠。

⚠️ 两个**明确不折叠**的邻居 —— 它们是**不同契约**，折叠会改写被哈希的字节，不是漏掉：

- `execution-policy.ts` 自己的 `serializePolicy`——**递归**排序；
- `build-evidence-manifest.ts` 的 `manifestRefForReceipt`——只排顶层，无嵌套层。

新访问器**恰好一层**，与三个旧函数体逐字一致 ⇒ 既有 stage receipt 的 `contentHash` 逐字节不变。

### 处置读数（谓词跑出来的，不是叙述）

判定谓词 = 该函数体的**结构**，与标识符无关（三个旧载体分别用 `value`/`v`、`sorted[key]`/`sorted[k]`）：

| | 载体数 | 文件 |
|---|---|---|
| 改动前（`develop`） | 3 | `execution-policy.ts` · `run-identity.ts` · `stage-receipt.ts` |
| 改动后（本分支） | 1 | `gate-script-base.ts` |

谓词 + 两个方向的控制已固化为 `plugin/test/gate-script-base.test.mjs` 的 6 条用例：单一定义 ratchet /
旧载体不得再内联且必须 import 共享的 / 与**逐字抄下来的改动前函数体**逐字节对拍 / 一层边界（三层不排序）/
不丢字段 / 删掉导出则消费者链接失败。

### ⚠️ 首版谓词是恒真的（已修，且修法本身有控制）

首版键在 `v` + `sorted[key]` 上：它能匹配新访问器，却**匹配不到任何一个**改动前的载体 ⇒ 一个抓不到它所防的
重复的 ratchet（硬规则 4c 的「空转」——判据恒真但与「验过了」同形）。已改为空白 + 标识符归一化，并
**每次运行都对三个逐字样本干跑一次**，使谓词不可能再静默失效。

变异控制（把函数体重新内联回 `run-identity.ts`）实测红 2 条 ⇒ ratchet 能咬。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `serializeidentity-serializereceipt`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791631645924`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/run-identity.ts`
- `plugin/scripts/stage-receipt.ts`
- `plugin/scripts/execution-policy.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-serializeidentity-serializereceipt.md`

## Blocker

**2026-10-10T12:04:19.078Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: peers ∪ mentions must equal the grep oracle for plugin/scripts/worker-driver.ts
- run_id：wk-prod-anchor
- session_id：faf82909-919d-43c3-a221-dace80a61318
