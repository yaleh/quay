---
id: gap-webui-goal-list-tab-split-goal-ac
title: web goal 页拆分为 Goals / Criteria 两个 tab——GOAL/AC 混排逼出 3 列结构性死格子、11
  列挤压成表头都被截断，复用既有 kind 参数路由，保持单次 goalList() 调用不变式
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（生产实例 `/goal`，1440px 视口，chrome-devtools 实测 DOM，2026-09-10）**：

列表页把 GOAL（12 条）与 AC/criterion（86 条）拍进同一张 11 列表格（`id/kind/status/goal/title/
criterion/recent verdict/last progress/first evidence/AC 达成/挂靠任务`），`table-layout:fixed` +
`width:100%` 把表格钉死在 `<main>` 容器宽度内，全列 `nowrap+ellipsis`。实测：

```
headers 渲染结果（表头文字本身被截断）："rec…" "la…" "fir…" "A…" "挂靠…"
GOAL-001 行： id      clientWidth 87  vs scrollWidth 100   （8 字符的 id 都装不下）
             status   clientWidth 78  vs scrollWidth 92    （achieved 截成 "achi…"）
             title    clientWidth 156 vs scrollWidth 336   （最核心的语义字段只剩不到一半可见）
             挂靠任务  clientWidth 70  vs scrollWidth 133
tableW 868 / mainW 900，rowCount 98（12 GOAL + 86 AC，`ls goals/*.md` 现读核实）
```

**根因（结构性,不是宽度分配没调好）**：GOAL 与 AC 是两种性质不同的对象混排进同一张表——

| | GOAL（12 条,增长慢,cap=3 active） | AC（86 条,随 GOAL 派生,增长快） |
|---|---|---|
| 有意义的列 | id/status/title/AC 达成/last progress/first evidence/挂靠任务（7列） | id/goal/status/title/criterion/recent verdict/last progress/挂靠任务（8列） |
| 结构性死列 | `criterion` 恒 `—`（store 层禁止 GOAL 记录带 criterion,`goal-store.ts` write() 显式 throw）、`recent verdict` 恒 `—`（GOAL 从不被 gate,只有它名下的 AC 被 gate） | `AC 达成`（rollup,对单条 AC 无意义）、`kind`（整张表已确定是 criterion,不需要列） |

混排逼着表格同时容纳两边的列(11 列),其中 3 列对任一侧都是死格子——这是挤压的根因,不是列宽
参数没调好。上一轮任务 `gap-webui-goal-list-sort-and-column-set`(已 done)修的是"整表 1538px
横向溢出 `<main>` 870px"(用 `table-layout:fixed` 强行收窄修的),这一轮要修的是"收窄的代价转嫁
成了每一列都读不全"——两个任务修的是相邻但不同的问题,不是重复。

**改法：拆成 Goals / Criteria 两个 tab,不新增路由参数,复用既有 `kind`**——`kind` 现在已经是
`goal|criterion` 的筛选语义,与"两个 tab"要表达的分区完全重合;按仓库单一正源原则,不新造
`tab=` 参数制造第二个正本。

1. **路由**：`/goal`(无 `kind`)默认落 **Goals tab**(`kind=goal`);`/goal?kind=criterion`
   为 **Criteria tab**;去掉现在的"All"合并视图。两个 tab 是纯服务端渲染的链接(复用现有
   `kindNav` 样式),不引入客户端 JS(延续 `gap-webui-goal-list-sort-and-column-set` AC5 的既有
   约束:排序/筛选不得引入客户端脚本)。
2. **Goals tab 列集合(7列)**:`id / status / title / AC 达成 / last progress / first evidence /
   挂靠任务`——去掉恒空的 `criterion`/`recent verdict`,去掉不需要的 `kind`。行数少(个位数到
   十几条),`title` 可给更宽裕的预算。默认排序改为**状态优先级**(active 最前,然后 draft →
   achieved → superseded → retired,组内 id 升序)——不再是纯 id 字典序,因为"当前在做的
   active GOAL"才是这张表最高频的查询目标。
3. **Criteria tab 列集合(8列)**:`id / goal / status / title / criterion / recent verdict /
   last progress / 挂靠任务`——新增 `goal` 列(链到 `/goal?kind=criterion&goal=<id>`,复用
   store 早就支持、但列表页从未暴露入口的 `?goal=` 筛选);去掉 `AC 达成`/`kind`;去掉
   `firstEvidenceAt`(AC 详情页 `/goal/AC-xxx` 已完整显示该字段,不丢信息)。默认排序沿用现有
   `defaultSortGoalRows` 的"按 goal 分组、组内 AC id 降序"逻辑,只是去掉其中的 GOAL 分支。
4. **跨 tab 衔接(两处,缺一不可,否则拆开后互相看不见)**:
   - Goals tab 每行的"AC 达成"/"挂靠任务"单元格链到 `/goal?kind=criterion&goal=<该GOAL id>`——
     "先看 GOAL 概览、点进去看它的 AC 明细"不需要离开列表页;
   - draft 待裁定横幅**必须跨 tab 可见**——现有代码注释已明令"它必须在任何筛选下都可见,否则
     提案写了也没人看得见"(`serve-goal.ts` 现有 `draftCount` 逻辑的既定原则)。`draftCount`
     拆成 `draftGoalCount`/`draftAcCount`(仍对未筛选的整份 `all` 数组算,一次读取内派生,不
     增加调用),当前 tab 显示自己那类;若另一 tab 也有待裁定,加一行"另有 N 条待裁定 →"链到
     那个 tab。
5. **性能不变式(必须保持,不能因为拆 tab 倒退)**:`gap-webui-goal-list-sort-and-column-set`
   AC7 把 `/goal` 的 `client.goalList()` 调用次数从 2 降到 1、账本只解析一遍。拆 tab 后仍然
   只读一次 `all` + 一次 `readGoalTasks()`(挂靠任务 rollup 的共享缓存),`kind` 只决定"把这份
   数据渲染成哪张表",在渲染层分叉成 `renderGoalsTable(all,…)`/`renderCriteriaTable(all,…)`
   两个函数,不是发两种查询。
6. **不改动的部分(明确边界,避免范围蔓延)**:`goals/` 目录存储层不动(GOAL/AC 混放本身是对的,
   已有 SPEC 依据);详情页 `/goal/<id>` 不动(它已经是"按 GOAL 分组显示 AC"的正确形态,本任务
   是把这个已验证的模式向列表页推广,不是另起一套);`status`/`sort`/`dir` 筛选机制照旧,只是
   分别套用到两张表各自的列集合。

**已确认不受影响的出链**:`grep -rn 'href="/goal' packages/quay/src/*.ts` 只有
`serve-dashboard.ts:987`(链到 `/goal/<id>` 详情页,不受影响)与 `serve-dashboard.ts:1004`
(裸 `/goal` 的"查看 Goals →",默认落 Goals tab 语义反而更准)。

**相关但不同的任务**:`gap-webui-goal-list-sort-and-column-set`(已 done)管列的取数/排序/
`origin` 列删除,是本任务列集合设计的基础,不是重复;本任务管"两个对象要不要拍进同一张表"
这个结构性问题。

## Acceptance Criteria

- [x] AC1 生产载体读数(取假:改动前 `/goal` 单页含 `kind=goal` 与 `kind=criterion` 两种行,
      表头 11 列):加载 `/goal`(无参数),断言页面渲染的表格 `<th>` 数 == 7 且不含
      `criterion`/`recent verdict`/`kind`;渲染的所有行 `kind` 均为 `goal`(枚举打印不符的行)。
- [x] AC2 加载 `/goal?kind=criterion`,断言表格 `<th>` 数 == 8 且不含 `AC 达成`/`kind`,含新增的
      `goal` 列;所有行 `kind` 均为 `criterion`。
- [x] AC3 挤压问题实测收窄(能取假,对照 AC1 现场基线数字):在两个 tab 分别测最长内容单元格的
      `scrollWidth - clientWidth`(取当前 12 条 GOAL / 86 条 AC 里最长的 title 行),断言差值相对
      改动前基线(title 336-156=180px)**下降至少 50%**;并断言**没有任何 `<th>` 的
      `scrollWidth > clientWidth`**(取假:改动前 `recent verdict`/`last progress`/`first
      evidence`/`AC 达成`/`挂靠任务` 五个表头均被截断)。
- [x] AC4 `?goal=` 筛选在 Criteria tab 有可点入口(M3 的 UI 化):断言 Criteria tab 每一行的
      `goal` 列渲染为指向 `/goal?kind=criterion&goal=<该行goal id>` 的 `<a>`;再断言 Goals tab
      每一行的"AC 达成"或"挂靠任务"单元格同样渲染为指向 `/goal?kind=criterion&goal=<该行id>`
      的 `<a>`(枚举一行验证跳转后 `<tr>` 数与该 goal 名下 AC 数一致)。
- [x] AC5 draft 跨 tab 可见性(硬性,取假用真实构造的负控制):用 `goal-store.ts write` 或
      MCP 构造一条 `status: draft` 的 AC(挂在某个 GOAL 下),加载 Goals tab(默认),断言页面
      出现"另有 N 条 AC 待裁定"提示且链到 `/goal?kind=criterion&status=draft`;反向构造一条
      `status: draft` 的 GOAL,加载 Criteria tab,断言出现对称的"另有 N 条 GOAL 待裁定"提示。
      两个方向都断言,只测一侧不算通过。
- [x] AC6 性能不变式不倒退(取假,回归 `gap-webui-goal-list-sort-and-column-set` AC7 的判据):
      对 `/goal` 与 `/goal?kind=criterion` 各发一次请求,断言单次请求内 `client.goalList()`
      调用次数 **== 1**、`ledgerEvidenceMap` 调用次数 **== 1**(spy 计数);且两个 tab 的 p50
      响应时间均 **<= 改动前 `/goal` 基线**(现读一次作为基线,不用旧文档里的历史数字)。
- [x] AC7 Goals tab 默认排序(取假,改动前是纯 id 字典序):构造一组含 active/draft/achieved 的
      GOAL 混合数据,加载 Goals tab 无 `?sort=` 参数,断言渲染顺序中所有 `status:active` 行排在
      所有非-active 行之前;`sort=`/`dir=` 显式参数仍可覆盖默认序(复用现有机制,断言不回归)。
- [x] AC8 站内出链不回归:断言 `serve-dashboard.ts` 渲染的 `/goal` 链接("查看 Goals →")落地页
      确为 Goals tab(即等价于 `?kind=goal` 的渲染结果,而非旧的"All"合并视图)。
- [x] AC9 `bash scripts/test.sh --for-task gap-webui-goal-list-tab-split-goal-ac` 退出码 0。

## Definition of Done

在**真实运行的实例**上截图:`/goal`(Goals tab,默认)与 `/goal?kind=criterion`(Criteria tab)
各一张,附 AC3 的挤压前后对照读数(scrollWidth-clientWidth 差值、表头是否再被截断)与 AC6 的调用
计数/响应时间前后对照;AC5 的双向 draft 可见性截图或响应体片段(两个方向各一次)一并贴进提交
信息。**单测绿不算达成**——必须有对本地临时 `quay serve` 实例的真实浏览器/DOM 复核证据(不得
连接或改动生产 100.78.206.100:4173 实例)。

## Touches

- `packages/quay/src/serve-goal.ts`
- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs`
- `packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs`
- `packages/quay/test/serve-goal-doc.test.mjs`
- `packages/quay/test/webui-modernist-sync.test.mjs`
- `packages/quay/test/gap-webui-goal-task-rollup-via-shared-summary-cache.test.mjs`
- `packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs`
- `tasks/gap-webui-goal-list-tab-split-goal-ac.md`
