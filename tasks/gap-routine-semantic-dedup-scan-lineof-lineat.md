---
id: gap-routine-semantic-dedup-scan-lineof-lineat
title: "semantic-dedup-scan: Five identical 1-based newline-count bodies split
  across two names (lineOf x2, lineAt x3) — the rename signal; repo-wide there
  are 10 copies including a PRIVAT"
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

## Disposition
**修掉了**（`extract`）。复核用 finding 自己的方法（归一化函数体摘要，非按名字），扫
`plugin/scripts/**` + `packages/*/src/**`：该族在 `plugin/scripts` 下实为 **12 个活副本**，
**两个名字**、**四种括号/参数写法** —— 比 finding 记的 10 个更多（另一条同 run 的 finding
`lineof-2` 点到 `.mjs` 那份，是第 12 个）：

| 体 | 数 | 落点 |
|---|---|---|
| `lineOf`（参数 `idx`，无括号） | 5 | deletion-closure / identity-replication / import-graph(`lineAt`) / sh-census(`lineAt`) / test-isolation(`lineAt`) |
| `lineOf`（参数 `index`，无括号） | 4 | goal-driver-task-boundary / kernel-sibling / registry-bare-filename / target-identity-literal |
| `lineOf`（参数 `idx`，有括号） | 1 | checker-lib.ts:113（**private**，与 `colOf` 同处） |
| `lineOf`（参数 `index`，有括号） | 1 | workflow-metadata-conformance.mjs:199 |
| `snippetOf` | 4 | 同上四个 `index` 文件 |
| `snippetAt` | 1 | test-isolation-check.ts |
| `relOf` | 2 | deletion-closure / identity-replication |

处置：
1. `lineOf` / `colOf` / `snippetOf` 上收到 `plugin/scripts/source-text-lib.ts` —— 该模块正是
   **同一条例程上一次**（finding `firstargregion-stripshellcomments`）为同一类问题建的，
   INVALIDATION 声明范围即「pure source-text primitives」。⛔ 不是 `checker-lib.ts`：其
   test 与 `checker-io.ts` 都记它为**判定侧**库，而行号/切片是纯文本变换、不是判定。
   11 个载体全部改为 import；`lineAt` 这个名字消失（finding 报的正是「rename signal」）。
2. `snippetAt` 折叠进 `snippetOf`：二者**只差一个无条件施加的宽度上限**，故 `maxLen = Infinity`
   （⛔ 不是某个"够大"的字面量，硬规则 4 推论二）逐字复现原无界体 —— 这次折叠**没有做语义选择**，
   这正是它可折叠而上面两个 stripper 不可折叠的原因；测试用
   `snippetOf(src, idx, Infinity) ≡ snippetOf(src, idx)` 钉住这一条。
3. `relOf`（`path.relative` 的一行包装）**就地内联**，不抽库：没有算法可共享，被报出的只是重名。

**可核性**（AC2）：修完不是终点 —— `plugin/test/source-text-lib.test.mjs` 新增**按位置判定**
（`buildNonCodeMask`，硬规则 2）的回归：任一 `plugin/scripts` 文件再自declare 该族任一函数即红，
且逐个断言 11 个载体都 import 共享模块。该谓词双向验证过：真声明命中；同样文本出现在注释 /
字符串 / 调用处**不**命中。⇒ 例程下一轮不会把同一批副本再报一次。

`plugin/test/fixtures/criterion-fidelity/` 下 2 个 fixture 保留自己的副本 —— 它们是钉住历史
快照的冻结件，不是活代码，⛔ 不属本族处置范围（已在扫描里单列）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `lineof-lineat`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790028867335`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/source-text-lib.ts`
- `plugin/scripts/checker-lib.ts`
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/identity-replication-check.ts`
- `plugin/scripts/import-graph-check.ts`
- `plugin/scripts/sh-census-check.ts`
- `plugin/scripts/test-isolation-check.ts`
- `plugin/scripts/goal-driver-task-boundary-check.ts`
- `plugin/scripts/kernel-sibling-resolution-check.ts`
- `plugin/scripts/registry-bare-filename-scan.ts`
- `plugin/scripts/target-identity-literal-check.ts`
- `plugin/scripts/workflow-metadata-conformance.mjs`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/source-text-lib.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-lineof-lineat.md`
