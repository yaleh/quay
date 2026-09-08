---
id: gap-webui-detail-page-head-drops-pagestyles
title: 三个详情页（/goal/:id /adr/:id /doc/:id）的 head 用「替换」而非「叠加」丢掉 pageStyles ⇒
  桌面端裸导航、移动端双导航；且无任何判据把 renderSiteNav 与它赖以显示的 stylesheet 绑在一起
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（2026-09-08 用 Playwright MCP 对生产实例 `http://100.78.206.100:4173` 实测，逐条 DOM/HTTP 读数，非目测）**：
`/goal/<id>`、`/adr/<id>`、`/doc/<id>` 三条路由的桌面端页首出现一整块**无样式**的裸导航——原生 checkbox、
`核心/观测/记录/知识` 四个分组标签、浏览器默认下划线链接；其下的 `.site-nav` 也失去 `.nav-item` 间距，
标签黏连成 `DashboardTasks` / `LiveBoardNEWSystemManagerNeeds Human`。

**取证（18 条路由逐条 fetch，grep CSS 规则 `.mobile-chrome {` 的命中数，枚举非抽查）**：

- 命中 **0**：`/goal/GOAL-003`、`/adr/ADR-001`、`/doc/DOC-001` —— 恰好 3 条
- 命中 **2**：其余 15 条路由（含同为详情页的 `/task/<id>`，它正常）

**根因（精确到既有任务的一行）**：`tasks/gap-ac100-webui-detail-pages-modernist-tokens.md:42` 逐字写的是
「三个详情 handler 由 `pageStyles()` **换成** `modernistStyles() + detailStyles()`」——**换成，而非追加**。
`pageStyles()`（`packages/quay/src/serve-render.ts:50`）里装着 `.mobile-chrome { display:none }`（`:226`）、
`@media` 下的 `.mobile-chrome { display:block }`（`:309`）与全部 `.nav-*` 规则；`detailStyles()`（`:404`）
只有 `.detail-page *` 的正文排版，一条导航规则都没有。三处调用点：`serve-goal.ts:133` / `serve-adr.ts:54` /
`serve-doc.ts:64`。

**移动端后果更重（390×844 实测）**：三条详情页的 `.mobile-chrome` 与 `.site-nav` 的 computed display
**同时为 block**（两套导航并存），`documentElement.scrollWidth = 792` vs 视口 `390` —— 横向溢出一倍。
同一视口下其余 15 条路由 `scrollWidth == 390` 且 `.site-nav` 为 `none`。

**为什么两道既有闸门都没拦住（这一条比缺陷本身更值得修）**：

1. `gap-ac100` 的 AC1 取假是「详情页代码段 `grep -cE '#[0-9a-fA-F]{6}'` >0 即假」——**只测有没有写死十六进制，
   不测导航在不在**；
2. `gap-ac100` 的 AC2 是「375×812 视口下可读」的截图判据，而双导航恰恰只在移动端才两块都显形——判据形态对了，
   但没有绑定到一个能取假的机件（硬规则 4 推论三：只能被人眼/fixture 满足的判据不是测量）；
3. `gap-webui-nav-inconsistent-routes`（done）修的是「只有 ~8/14 路由调用 `renderSiteNav()`」——**它把导航的
   markup 接全了，却没有任何判据把 markup 与它赖以显示的 stylesheet 绑在一起**。三条详情页至今
   `renderSiteNav()` 调用正常、CSS 缺失，正落在这个缝里。

⇒ 因此本任务的修法**不是补三行 `pageStyles()` 就完**（硬规则 5b：修好一处 ≠ 只有一处）。源头修法是把
「页面外壳所需的全部样式」收成**一个不可被部分调用的入口**（例如 `serve-render.ts` 导出
`shellStyles(kind)`，内部固定包含 nav/mobile-chrome 规则，详情页额外叠加 detail 排版），并配一个
**枚举全部路由**的判据：凡输出 `class="site-nav"` 的 HTML 必须同时输出 `.mobile-chrome {` 规则。

## Acceptance Criteria

- [x] AC1 三条详情路由补齐外壳样式：对运行中的实例跑
      `for p in /goal/<id> /adr/<id> /doc/<id>; do curl -s "$BASE$p" | grep -c '\.mobile-chrome {'; done`，
      三个数字**均 ≥1**。取假：改动前跑同一条命令三个数字均为 `0`（已实测）。
- [x] AC2 判据是**枚举**而非抽查：新测试遍历路由注册表里**全部**页面路由，断言「HTML 含 `class="site-nav"`」
      ⇒「HTML 含 `.mobile-chrome {`」对每一条成立，并在断言失败时打印**违例路由清单**（条数 + 路由名），
      而不是只报一个布尔（硬规则 3 枚举不布尔）。
- [x] AC3 判据能取假（mutation 负控制）：测试中以一段「只调 `renderSiteNav()` 不调外壳样式」的 HTML 字符串
      喂给 AC2 的纯判定函数，断言它**报红**；再喂一段两者齐全的，断言它**报绿**。两个方向都断言，
      不只断言绿的那一侧。
- [x] AC4 移动端形态恢复：390×844 视口下对三条详情路由断言
      `getComputedStyle(document.querySelector('.site-nav')).display === 'none'` 且
      `document.documentElement.scrollWidth === document.documentElement.clientWidth`。
      取假：改动前实测为 `block` 与 `792 !== 390`。
- [x] AC5 `bash scripts/test.sh --for-task gap-webui-detail-page-head-drops-pagestyles` 退出码 0。

## Definition of Done

在**真实运行的 `quay serve` 实例**上（不是 fixture、不是单测里的假 HTML）打开
`/goal/<id>`、`/adr/<id>`、`/doc/<id>` 三页，桌面端页首**不再出现裸 checkbox 与无样式分组链接**、
导航栏与 `/dashboard` 逐像素同形态；移动端 390 宽只剩一套汉堡导航、无横向滚动条。
命令与截图贴进提交信息。**「测试已存在」不算达成**——必须有对生产载体的这一次实际读数（DIR-026 Reading A）。

## Touches

- `packages/quay/src/serve-render.ts`
- `packages/quay/src/serve-goal.ts`
- `packages/quay/src/serve-adr.ts`
- `packages/quay/src/serve-doc.ts`
- `packages/quay/test/gap-webui-detail-page-head-drops-pagestyles.test.mjs`
- `tasks/gap-webui-detail-page-head-drops-pagestyles.md`
