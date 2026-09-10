---
id: gap-webui-goal-detail-no-entity-links
title: goal 详情页只渲染 body markdown、不渲染实体关系 ⇒ main 内链接数为 0；反向边（GOAL→AC）在存储里根本不存在（AC
  单向持 goal 字段、GOAL 无 children），而详情页唯一的 ABI 调用 goalGet 返回的 view-model 里没有装 AC 的位置
  —— 结构上不可能显示
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-webui-detail-page-head-drops-pagestyles
---
**type:** execution

## Proposal

**现象（2026-09-08 对生产实例实测 DOM，两个 goal 各测一次）**：

`/goal/GOAL-003`：
- `document.querySelectorAll('main a').length` = **0** —— 整个正文区**一条链接都没有**
- 正文里逐字提到 `AC156`…`AC169`（14 个 criterion 编号）全是纯文本，点不动
- 没有返回 `/goal` 列表的链接（`main a[href="/goal"]` 不存在）
- 该 goal 名下有 criterion 记录，详情页**一条都不列**

`/goal/GOAL-008`（人 2026-09-08 复报，更极端的形态）：
- `main a` = **0**、`<article>` 文本长度 = **0**（该 goal 正文全空）、
  页面上 `AC-\d+` 出现次数 = **0**，而它名下**实有 5 条 AC**（AC-195…AC-199）
- 即：页面 = 标题 + 一行 meta + 一坨 1138 字符的 origin + 空 article

同一时刻 `/dashboard` 的「阶段目标」卡却能显示 `GOAL-003 … AC 达成 12/14`
—— **概览页算得出的进度，专题页反而看不到**。

**根因（2026-09-08 复查后由「渲染层没写」修正为「数据形状不允许」——这是本次更正的重点）**：

初稿把根因写成「详情页只渲染标量 + body markdown、没有查询子 criterion」。查完存储模型后，
真正的约束更硬一层：

    AC-197 的 frontmatter 键: [criterion, expect, goal, id, kind, origin, status, title]
                              goal = GOAL-008        parent = (无此键)
    GOAL-008 的 frontmatter 键: [id, kind, origin, status, title]
                              children = (无此键)

**边是单向、扁平的**：AC 上有 `goal: <GOAL-id>`，**GOAL 记录上没有任何反向引用**；
`GoalViewModel`（`packages/quay/src/goal-store.ts:200-213`）的字段里**也没有 children/acs**。
而详情页 handler **全程只发一次 ABI 调用 `client.goalGet(goalId)`**
⇒ **它拿回来的那个 record 的类型里根本没有装 AC 的位置**。
不是忘了渲染，是**反向边不存在于存储中，必须靠扫描算出来**。

**反向边的现成算法已经存在，只差没被用**：`goal-store.ts:338` 有
`.filter(g => filter.goal ? g.goal === filter.goal : true)`，ABI
`goalList(filter: Record<string, unknown>)`（`provider-client.ts:171`）原样透传。

**代价：正解是「换」不是「加」（实测支撑，别做成多发一次查询）**：
`list()` 的实现是**先 readdir 读全部 65 个文件、再在内存里 filter**，所以带筛选与不带筛选**一样贵**；
且 `goalGet` 与 `goalList` **各自都要解析一遍 6.87MB 的 `.quay/gate-events.jsonl`**（实测 183ms）。
实测 `/goal/<id>`（1 次 goalGet）= **0.22s**，`/goal`（2 次 goalList）= **0.41–0.50s**
⇒ 单次 store 调用 ≈ **0.2s**。
因此详情页应当**用一次 `goalList()` 取代 `goalGet()`**：一次调用、一次账本解析，
在返回的数组里既挑出本记录、又 filter 出它的全部 AC。**成本大致持平，AC 白得**；
若实现成「goalGet + 再来一次 goalList」，就是白白多付一次 0.2s + 多解析一遍 6.87MB。

**为什么这是机制而不是「加个链接就完」**：同样的形状在 `/adr/<id>`、`/doc/<id>` 上也成立
（三者共用同一套详情页 shell）。任何一个实体详情页都缺同一件事：**子实体列表 + 正文实体编号回链 +
返回上一级**。修法应落在共享处，而不是只给 goal 补一份（硬规则 5b）。
另外 `renderMarkdown` 把正文的 `##` 渲染成 `<h3>`，与页面 `<h1>` 之间**跳过了 `<h2>`**（实测 headings
序列为 `h1 → h3 × 5`），顺带一并修。

**修法方向**：

1. 详情页把 `client.goalGet(id)` 换成**一次** `client.goalList()`，从返回数组里取本记录 +
   `filter(r => r.goal === id)` 得到它的 criterion 集合；增加「本 goal 的 criterion」区块
   （id / status / 最近 verdict），与 `/goal` 列表用同一套行渲染，不复制一份；
2. 正文渲染时把匹配实体编号形态（`AC-?\d+` / `GOAL-\d+` / `DIR-\d+` / `ADR-\d+`）的裸文本
   **在实体确实存在时**回链到对应详情页——不存在则保持纯文本（不能造死链）；
3. 补面包屑 / 返回上一级链接；
4. 正文标题层级由 `<h3>` 起改为 `<h2>` 起，消除 h1→h3 跳级。

**相关但不同的两条**（不要在本任务里顺手做，会造成同文件返工）：
`gap-webui-goal-list-sort-and-column-set` 管列表页的列/排序/`?goal=` 筛选；
`gap-goal-record-completeness-undefined` 管**产生侧**（为什么 GOAL-008 正文为空、内容都在 origin）。

## Acceptance Criteria

- [x] AC1 生产载体读数、两个形态都测：加载 `/goal/GOAL-003` 断言 `main a` **>= 15**
      （14 个 AC 回链 + 1 个返回链接的下界，取假：改动前实测 **0**）；
      再加载 `/goal/GOAL-008`（**正文为空的形态**）断言 `main a` **>= 6**（5 条 AC + 返回链接）
      且页面上 `AC-\d+` 出现次数 **>= 5**。取假：改动前两项实测均为 **0**。
- [x] AC2 子实体列表真的来自查询而非硬编码：断言页面上列出的 criterion 条数 == 用 store 按
      `goal == <id>` 查出的条数（GOAL-008 应为 **5**）；不等时打印双方条数与差集前 3 条。
- [x] AC3 回链不造死链（两个方向都断言）：单测对一段同时含**存在的**实体编号与**不存在的**实体编号的正文，
      断言前者被渲染成 `<a>`、后者**保持纯文本**。只断言其中一侧不算通过。
- [x] AC4 三个详情页同修（硬规则 5b）：对 `/goal/<id>`、`/adr/<id>`、`/doc/<id>` **各自**断言
      `main a` 数 > 0 且存在返回上一级链接；打印仍为 0 的页面清单与条数。
- [x] AC5 标题层级无跳级：断言三个详情页的 heading 序列中不存在「从 hN 直接跳到 h(N+2)」的相邻对；
      失败时打印跳级位置清单。取假：改动前 `/goal/GOAL-003` 实测 `h1 → h3`。
- [x] AC6 是「换」不是「加」（能取假的代价判据）：断言单次 `/goal/<id>` 请求中
      **store 侧调用总次数 <= 1**（spy 计数 `goalGet` + `goalList` 之和）、
      且 `ledgerEvidenceMap` 调用次数 **<= 1**；并断言 `/goal/<id>` 的 p50 响应时间
      <= **改动前基线 0.22s + 100ms**。取假：实现成 goalGet + goalList 则计数为 2、账本被解析两遍。
- [x] AC7 `bash scripts/test.sh --for-task gap-webui-goal-detail-no-entity-links` 退出码 0。

## Definition of Done

在**真实运行的实例**上从 `/goal` 列表点进 `GOAL-003` 与 `GOAL-008` 两页：
都能看到名下 criterion 的完整清单与各自状态（GOAL-008 应列出 5 条），
点击正文里的实体编号能跳到该 criterion 详情，再点返回链接回到 `/goal`——这条来回路径截图贴进提交信息；
并贴 AC6 的调用计数与前后响应时间读数。
**「加了 renderer + 单测绿」不算达成**，必须走通这一次真实点击路径。

## Touches

- `packages/quay/src/serve-goal.ts`
- `packages/quay/src/serve-adr.ts`
- `packages/quay/src/serve-doc.ts`
- `packages/quay/src/serve-render.ts`
- `packages/quay/test/gap-webui-goal-detail-no-entity-links.test.mjs`
- `packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs`
- `tasks/gap-webui-goal-detail-no-entity-links.md`
