---
id: gap-webui-goal-detail-no-entity-links
title: goal 详情页只渲染 body markdown、不渲染实体关系 ⇒ main 内链接数为 0：正文提到的 AC156–AC169
  不可点、无返回列表链接、名下 59 条 criterion 一条不列（而 dashboard 能算出「AC 达成 12/14」）
status: ready
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

**现象（2026-09-08 对生产实例 `/goal/GOAL-003` 实测 DOM）**：

- `document.querySelectorAll('main a').length` = **0** —— 整个正文区**一条链接都没有**
- 正文里逐字提到 `AC156`…`AC169`（14 个 criterion 编号）全是纯文本，点不动
- 没有返回 `/goal` 列表的链接（`main a[href="/goal"]` 不存在）
- 该 goal 名下在 `/goal` 列表里有 **59 条 criterion 行**（`goal` 列 = `GOAL-002`/`GOAL-003` 等），
  详情页**一条都不列**
- 同一时刻 `/dashboard` 的「阶段目标」卡却显示 `GOAL-003 … AC 达成 12/14` —— **概览页算得出的进度，
  专题页反而看不到**

**根因**：`packages/quay/src/serve-goal.ts:133-146` 的详情页渲染只做两件事——把若干标量字段
（`kind`/`status`/`goal`/`criterion`/`expect`/`origin`）铺成 `<p class="meta">`，再
`renderMarkdown(g.body)` 把正文整段渲染出来。**没有任何一处查询「以本 goal 为 parent 的 criterion 集合」，
也没有把正文里的实体编号回链到实体**。即：详情页把 goal 当作一篇**文档**渲染，而不是当作一个**有关系的实体**。

**为什么这是机制而不是「加个链接就完」**：同样的形状在 `/adr/<id>`、`/doc/<id>` 上也成立
（三者共用同一套详情页 shell）。任何一个实体详情页都缺同一件事：**子实体列表 + 正文实体编号回链 +
返回上一级**。修法应落在共享处，而不是只给 goal 补一份（硬规则 5b）。
另外 `renderMarkdown` 把正文的 `##` 渲染成 `<h3>`，与页面 `<h1>` 之间**跳过了 `<h2>`**（实测 headings
序列为 `h1 → h3 × 5`），顺带一并修。

**修法方向**：

1. 详情页增加「本 goal 的 criterion」区块——按 `goal` 字段反查并列表呈现（id / status / 最近 verdict），
   与 `/goal` 列表用同一套行渲染，不复制一份；
2. 正文渲染时把匹配实体编号形态（`AC-?\d+` / `GOAL-\d+` / `DIR-\d+` / `ADR-\d+`）的裸文本
   **在实体确实存在时**回链到对应详情页——不存在则保持纯文本（不能造死链）；
3. 补面包屑 / 返回上一级链接；
4. 正文标题层级由 `<h3>` 起改为 `<h2>` 起，消除 h1→h3 跳级。

## Acceptance Criteria

- [ ] AC1 生产载体读数：加载 `/goal/GOAL-003`，断言 `document.querySelectorAll('main a').length` **>= 15**
      （14 个 AC 回链 + 1 个返回链接的下界）。取假：改动前实测 **0**。
- [ ] AC2 子实体列表真的来自查询而非硬编码：断言页面上列出的 criterion 条数 == 用
      `task/goal` store 按 `goal == GOAL-003` 查出的条数；两者不等时打印双方条数与差集前 3 条。
- [ ] AC3 回链不造死链（两个方向都断言）：单测对一段同时含**存在的**实体编号与**不存在的**实体编号的正文，
      断言前者被渲染成 `<a>`、后者**保持纯文本**。只断言其中一侧不算通过。
- [ ] AC4 三个详情页同修（硬规则 5b）：对 `/goal/<id>`、`/adr/<id>`、`/doc/<id>` **各自**断言
      `main a` 数 > 0 且存在返回上一级链接；打印仍为 0 的页面清单与条数。
- [ ] AC5 标题层级无跳级：断言三个详情页的 heading 序列中不存在「从 hN 直接跳到 h(N+2)」的相邻对；
      失败时打印跳级位置清单。取假：改动前 `/goal/GOAL-003` 实测 `h1 → h3`。
- [ ] AC6 `bash scripts/test.sh --for-task gap-webui-goal-detail-no-entity-links` 退出码 0。

## Definition of Done

在**真实运行的实例**上从 `/goal` 列表点进 `GOAL-003`，页面上能看到它名下 criterion 的完整清单与各自状态，
点击正文里的 `AC160` 能跳到该 criterion 详情，再点返回链接回到 `/goal`——这条来回路径截图贴进提交信息。
**「加了 renderer + 单测绿」不算达成**，必须走通这一次真实点击路径。

## Touches

- `packages/quay/src/serve-goal.ts`
- `packages/quay/src/serve-adr.ts`
- `packages/quay/src/serve-doc.ts`
- `packages/quay/src/serve-render.ts`
- `packages/quay/test/gap-webui-goal-detail-no-entity-links.test.mjs`
- `tasks/gap-webui-goal-detail-no-entity-links.md`
