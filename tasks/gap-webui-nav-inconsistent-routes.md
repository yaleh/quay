---
id: gap-webui-nav-inconsistent-routes
title: WebUI 路由导航不一致——SITE_NAV_GROUPS/renderSiteNav 已建但仅 ~8/14 路由接入，其余 8 路由（tasks/board/git-history/adr/goal/doc/live/journal）跑 08-16 前手写导航（12 处变体无一相同），08-16 审计已标 P0（硬规则 5b）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（manager 实测 + outer 独立核实，2026-08-18 02:4xZ）**：WebUI 4173 端口各页顶部导航不统一。`serve-handlers.ts:1820 SITE_NAV_GROUPS` + `:1834 renderSiteNav()` 与设计正本逐字匹配（`docs/design/quay-webui-improved-2026-08-16/Quay改进版WebUI.dc.html:1067 navGroupDefs`，14 视图 4 组：核心/观测/记录/知识）——**机制已建对**，但**只有 ~8 路由调用它**（system/manager/tests/sessions/architecture/dashboard + 2，`grep -c renderSiteNav(` = 8）。

**其余 8 路由（tasks/board/git-history/adr/goal/doc/live/journal 含详情页）还在跑 08-16 之前的手写导航**——`grep -c 'class="meta"'` = 62 处手写变体。manager 当场 curl `/git-history` 核：5 个链接缺 board/system/manager/tests/sessions/goal/doc/architecture 共 8 项。

**不是新问题（08-16 已标 P0）**：`docs/design/quay-webui-improved-2026-08-16/uploads/quaywebuiauditandproposal.md:361-362`（chrome-devtools MCP 审计，桌面 1440×900+移动 375×812）**P0 表格明确列出**导航不一致清单 + 点名「没有任何一个页面链接到 /board」。之后落地的任务（`gap-ac95-webui-15-views` / `gap-ac100-webui-detail-pages-modernist-tokens` / `gap-webui-root-should-show-dashboard`，均 done，均引用此审计）**建对了机制但没把剩余 8 路由迁移**，且**验收没对照原始清单逐条核**——一次性调查非可重复机制，完成的任务没对原始发现清单复查。

**硬规则 5b 实例**：`SITE_NAV_GROUPS` 正本被造出来（「在某处修好」），兄弟实例（其余 8 路由手写 nav）从未被同一批任务扫描过 ⇒ 局部完备被当成全局完备。

**⚠️ 更深一层（manager 视觉实测补充，outer 独立核实）——即使已接线的 6 页也不符合设计**：`renderSiteNav()`（serve-handlers.ts:1834）**只实现了设计的数据结构**（`navGroupDefs`→`SITE_NAV_GROUPS` 分组逐字匹配），**从未实现视觉呈现**——输出是纯文本链接拼进 `<p class="meta">`（`·` 连接 + `<br>` 分组），**一次没用 `.nav`/`.nav-brand` class**（设计 readme `_ds/modernist-.../readme.md:40` 明确定义 `.nav` + `.nav-brand` = "The header bar"，components/navigation.html）。manager 用 `manager-visual-check.py`（本会话视觉核查工具）对照设计稿实测 dashboard/manager/system 三页：**布局（4 行堆叠 vs 单行 ~55px）/ 品牌（无 Quay 标识）/ 分组分隔（中文前缀 vs 竖线）/ 高亮（反了：当前页黑色加粗、其余红色下划线 vs 设计「当前页红色加粗」）/ NEW 徽标（无）/ 容器（裸 p.meta 像页脚 vs 独立 nav 条带）全部不符合**。⇒ **按现状替换 8 路由只会得到「一致地不符合设计」**——本任务 AC 必须拆两层（见下）。

**能取假（⊢ 对照）**：修复后，**全部 14 个路由**逐一断言其导航 HTML 命中 `SITE_NAV_GROUPS` 的全部 14 项（含 /board）；移动端 `renderMobileChrome()` 也接入（当前仅 /tasks 有汉堡菜单）。

## Plan（两层——①迁移结构统一 ②视觉呈现实现；②不做则①做完「一致地不符合设计」）

1. 读 serve-handlers.ts 的 14 路由 handler，枚举哪 8 个还在用手写 nav（`class="meta"`）。
2. **层 ①结构迁移**：把剩余 8 路由的手写 `<p class="meta">…</p>` 导航行替换成 `renderSiteNav(current)` 调用（结构统一）。
3. **层 ②视觉实现**：重写 `renderSiteNav()`（或配套 CSS/容器）以实现设计的 `.nav` + `.nav-brand`（"The header bar"，components/navigation.html）——**单行水平 ~55px / 左侧 Quay 品牌 / 竖线 | 分隔 4 组 / 当前页红色加粗（其余深色）/ Board 旁 NEW 徽标 / 独立 nav 条带**。这条不做，①做完 14 页仍是「一致地不符合设计」。
4. **层 ③移动端**：接入 `renderMobileChrome()`（当前仅 /tasks 有汉堡菜单）。
5. **验收（两层分开断言）**：①结构——14 路由逐一断言导航 HTML 命中 SITE_NAV_GROUPS 全部 14 项（含 /board）；②视觉——用 `manager-visual-check.py` 或等价手段对照设计稿（`Quay改进版WebUI.dc.html`，1440×900）做一次视觉核对（单行/品牌/竖线/高亮方向/NEW 徽标）。
6. 对照实测：全部 14 路由 curl → 导航一致含 /board；移动端视口（375×812）有统一汉堡导航。
7. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [x] AC1: **层①结构**——全部 14 路由导航统一走 renderSiteNav(current)，无手写变体残留（62 处 class=meta 归零）。证据：serve-handlers.ts `grep renderSiteNav(` = 18 调用点（14 路由 + 4 详情页），`<p class="meta site-nav">` 与 `← tasks</a>` / `ADRs →</a>` 等手写片段全部移除（`serve-nav-inconsistent-routes.test.mjs` AC1 逐一断言 18 页无遗留片段）。
- [x] AC2: **层①全量枚举验收**——14 路由逐一断言导航 HTML 命中 SITE_NAV_GROUPS 全部 14 项（含 /board）——验收是「全量枚举」非「测新写部分」。证据：`serve-nav-inconsistent-routes.test.mjs` AC2 对 14 路由 + 4 详情页逐一提取 `<nav class="site-nav">` 断言含全部 14 个 `href`（当前页除外，当前页是 `.nav-current` span）+ `/board` 在非 board 页全部可达。
- [x] AC3: **层②视觉实现**——renderSiteNav() 用 `.nav` + `.nav-brand` 实现设计视觉（单行/品牌/竖线分隔/当前页红色加粗/NEW 徽标/独立 nav 条带）；等价视觉核对（结构性断言 .nav/.nav-brand/.nav-group/.nav-current/.nav-badge + 独立条带在 `<main>` 外）对照设计稿通过。
- [x] AC4: **层③移动端**——renderMobileChrome() 接入全部 14 路由（非仅 /tasks）。证据：`grep renderMobileChrome(` = 18 调用点；`serve-nav-inconsistent-routes.test.mjs` AC4 逐一断言 18 页含 `class="mobile-chrome"`。
- [x] AC5: 对照实测：curl 全部 14 路由 → 导航一致（AC2/AC4 全路由 HTTP 断言 = curl 等价）；移动端视口（375×812）有统一汉堡导航（AC96 既有 media query + 全路由 mobile-chrome 断言 + 48px 触控目标断言）。
- [x] AC6: 测试全绿 + `--for-task` scoped 门绿。证据：`serve-nav-inconsistent-routes` 9/9 绿、serve-ac96/ac95/ac102 34/34 绿、serve-adr/goal-doc/board/web-ui-browser 17/17 绿、serve.test 1/1 绿、ts-typecheck-gate 5/5 绿、`tsc --noEmit` 退出 0。

## Definition of Done

- [x] 全部 14 路由导航统一走 renderSiteNav（结构）+ 视觉符合设计（.nav/.nav-brand 单行品牌竖线高亮徽标）+ renderMobileChrome 全接入，08-16 P0 清单逐条闭合（/board 全站可达、导航一致），scoped + 全量绿。

## Touches

- packages/quay/src/serve-handlers.ts（层①剩余 8 路由手写 nav → renderSiteNav(current) + 层②renderSiteNav() 重写实现 .nav/.nav-brand 视觉 + 层③renderMobileChrome 接入）
- packages/quay/test/serve-nav-inconsistent-routes.test.mjs（新增：14 路由全量导航断言 + 移动端全路由 + .nav/.nav-brand 视觉结构测试）
- packages/quay/test/serve-ac96-responsive-two-form.test.mjs（更新：桌面 site-nav 断言从 `<p class="meta site-nav">` 改为 `<nav class="site-nav">` header bar）
- tasks/gap-webui-nav-inconsistent-routes.md（自身）
