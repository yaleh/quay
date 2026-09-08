---
id: gap-webui-goal-task-rollup-via-shared-summary-cache
title: goal↔task 的结构化关系（顶层 goal_ac，35/1881 携带、32/57 criterion 有挂靠）从未被任何读面消费；Core
  唯一取数路径 ABI taskList 实测 2.9s，须复用 dashboard 已有的 30s TTL
  taskSummaryCache，且「未挂靠」必须是与 0 和「未读到」都可区分的独立态
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-webui-goal-list-sort-and-column-set
---
**type:** execution

## Proposal

**来源**：人 2026-09-08 走查 `/goal` 提出的第四点——「如有可能，应统计 goal 相关的任务的信息并显示
（详情页也应当提供）」，并特别要求先讨论「`goal 相关的任务` 查询的耗时」。讨论后人裁定：
**取数走方案 A（复用 dashboard 已有的 30s TTL 缓存）；稀疏数据先按现状显示，把「未挂靠」标成独立态。**

**机制 —— 关系已被结构化记录，却没有任何读面消费它。**
task 的顶层字段 `goal_ac`（"Owning goal AC id，task→AC linkage"）在 schema 里是一等公民，
但从 `/goal` 列表、`/goal/<id>` 详情到 `/task/<id>`，**没有任何一个页面读它**。
唯一沾边的是 dashboard 的 `renderGoalCard`（`serve-dashboard.ts:688`），它算的是
`goals.filter(r => r.goal === gid)` 的 **AC 达成数（12/14）**——纯 goal store 内部关系，
**一次任务查询都没发**。所以 goal↔AC 的统计早已免费存在，goal↔task 的统计则一片空白。

**数据可用性实测（先摆出来，因为它决定了怎么显示，而不是要不要做）**：

- 携带顶层 `goal_ac` 的任务：**35 / 1881（1.9%）**（`extra.goal_ac` 嵌套形式：**0**）
- 有 ≥1 个任务挂靠的 criterion：**32 / 57（56%）**，每个 AC 最多 **2** 条
- 按 goal 汇总：`GOAL-001 = 11`、`GOAL-003 = 13`、`GOAL-007 = 6`、`GOAL-008 = 5`，**其余 4 个 goal = 0**
- 另有 **175 个任务在正文里提到 `AC-1xx`** 却没有结构化字段 —— 关系存在但未登记

⇒ 做出来后，约一半的 AC 与一半的 goal 会是空。**这不是缺陷，是真实的稀疏**；
但按硬规则 6（缺值 = 未查，不是为假）与 3b（读不懂输入时不得返回与合格同形的值），
**「未挂靠」必须与「挂靠了 0 条」以及「这次没读到任务库」三者互不相同**——
否则读者会把「干了但没登记」误读成「没人干」。

**耗时（人点名要讨论的那一项，实测而非估计）**：

| 量 | 实测 |
|---|---|
| `/goal` 当前 | 0.60–0.75 s |
| `/goal/<id>` 当前 | 0.22 s |
| **Provider ABI 一次 `taskList`** | **2.9 s** ← 唯一的大头 |
| 直读 native 的 `tasks/.quay-parse-cache.json` 并按 `goal_ac` 聚合 1881 条 | 25 ms |
| 完全不用 cache，硬读 1881 个文件前 2KB | 99 ms |

**结论：贵的不是「扫任务」（25–100ms），是走 ABI 那一跳。** 直接同步调 `taskList` 会把 0.6s 的页面拖到 3.5s。
而 Core 必须 provider-agnostic —— **直读 `tasks/.quay-parse-cache.json` 是 native provider 的私有实现，禁止**。

**人裁定的方案 A**：复用 `serve-dashboard.ts:887` 已有的
`TASK_SUMMARY_CACHE_TTL_MS = 30_000` + `taskSummaryCache`（按 `workspaceRoot` 键、
喂给它的是 `client.taskList({ includeBody: false })`、失败时 fail-open 并缓存错误整个 TTL）。
**同一个 30s 窗口内 dashboard 与 `/goal` 共享同一份数据，成本摊薄而非叠加**；
命中时增量 ≈ 0ms，未命中时那一次 2.9s 本来 dashboard 也要付。
不新建缓存、不新增 ABI 动词。

**修法方向**：

1. 把 `taskSummaryCache` 的访问器从 `serve-dashboard.ts` export 出来（或提到共享模块），
   `serve-goal.ts` **import 复用，不得另起一个 Map**；
2. rollup 口径：**goal 的任务数 = 其全部 criterion 的任务数之和**（任务挂在 AC 上，不直接挂 goal），
   与 `renderGoalCard:688` 的 AC 归属口径一致；
3. 列表页给 criterion 行显示「挂靠任务数 + 状态分布」，给 goal 行显示 rollup 汇总；
   详情页在 `gap-webui-goal-list-sort-and-column-set` 建立的 criterion 区块里同样呈现；
4. 三态显式：`未挂靠`（该记录无任何任务引用）/ 具体计数 / `未读到`（本次 taskList 失败或缓存内是错误态）。

**同文件重叠**：`depends_on gap-webui-goal-list-sort-and-column-set` —— 本任务要往它重排后的列集合与
详情页区块里加一列/一块，反序等于往一个即将被重排的表里插列（memory `dispatch-order-by-touches-overlap-direction`）。

## Acceptance Criteria

- [x] AC1 生产载体读数、数值对得上真值：加载 `/goal`，断言 `GOAL-001 / GOAL-003 / GOAL-007 / GOAL-008`
      四行显示的挂靠任务数分别为 **11 / 13 / 6 / 5**（2026-09-08 实测真值，实现时应以当时重算的真值为准并写进提交信息），
      其余 4 个 goal 显示「未挂靠」。不一致时打印 `(goal, 页面值, 账本真值)` 清单。
- [x] AC2 三态互不相同（硬规则 6/3b 的直接落实，三个方向都断言）：
      喂三个输入——(a) 有 2 条挂靠任务、(b) 无任何任务引用、(c) `taskList` 抛错——
      断言渲染出的字符串**两两不相等**，且 (b) 不等于 `"0"`、(c) 不等于 (b)。
- [x] AC3 复用而非新建缓存（能取假）：断言 `serve-goal.ts` 里 `import` 了 dashboard 的缓存访问器；
      且断言在同一 30s 窗口内先请求 `/dashboard` 再请求 `/goal` 时，`client.taskList` 的调用次数**合计为 1**
      （spy/计数器）。取假：若各自建缓存则为 2。
- [x] AC4 代价上界（人点名的那一项，能取假）：缓存命中时断言 `/goal` p50 <= 前置任务落地后的基线 + **50ms**；
      缓存未命中时断言 <= 基线 + **3.5s** 且页面仍**完整渲染**（HTTP 200、其余列齐全）。
      把两种情形的实测值都打印出来。
- [x] AC5 fail-open 不是 fail-silent：模拟 `taskList` 抛错，断言页面仍 200、其余列正常、
      且统计列显示「未读到」并**携带失败原因的子串**（不是裸的 `—`，硬规则 3b）。
- [x] AC6 rollup 口径正确：断言每个 goal 的显示值 == 其全部 criterion 的挂靠数之和；
      并断言直接挂在 goal 上（而非 AC 上）的任务不被重复计入。不一致时打印 goal 清单与两侧数值。
- [x] AC7 详情页同样提供：`/goal/<id>` 上断言统计存在，且对同一 id 与列表页取值相等。
- [x] AC8 `bash scripts/test.sh --for-task gap-webui-goal-task-rollup-via-shared-summary-cache` 退出码 0。

## Definition of Done

在**真实运行的实例**上截 `/goal` 与 `/goal/<id>`：有挂靠的 goal 显示真实计数与状态分布，
无挂靠的显式标为「未挂靠」而非 0；再人为让 `taskList` 失败一次，截图证明页面仍完整且该列显示「未读到」。
AC4 的两组耗时实测（命中 / 未命中）与 AC3 的调用次数计数一并贴进提交信息。
**「统计函数写好了 + 单测绿」不算达成**——必须有这三张生产页面截图与那组耗时读数。

## Touches

- `packages/quay/src/serve-goal.ts`
- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/test/gap-webui-goal-task-rollup-via-shared-summary-cache.test.mjs`
- `packages/quay/src/serve-handlers.ts`
- `packages/quay-native/src/store.ts`
- `packages/quay/src/abi.ts`
- `tasks/gap-webui-goal-task-rollup-via-shared-summary-cache.md`