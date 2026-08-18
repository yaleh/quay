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

**能取假（⊢ 对照）**：修复后，**全部 14 个路由**逐一断言其导航 HTML 命中 `SITE_NAV_GROUPS` 的全部 14 项（含 /board）；移动端 `renderMobileChrome()` 也接入（当前仅 /tasks 有汉堡菜单）。

## Plan

1. 读 serve-handlers.ts 的 14 路由 handler，枚举哪 8 个还在用手写 nav（`class="meta"`）。
2. 把剩余 8 路由的手写 `<p class="meta">…</p>` 导航行替换成 `renderSiteNav(current)` 调用（纯替换，机制已存在）。
3. 顺带接入 `renderMobileChrome()`（当前仅 /tasks 有移动端汉堡菜单）。
4. **验收方式改**：枚举全部 14 路由逐条断言导航 HTML 命中 SITE_NAV_GROUPS 全部 14 项（防「只测新写的那部分」重演）。
5. 对照实测：全部 14 路由 curl → 导航一致含 /board；移动端视口有统一导航入口。
6. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [ ] AC1: 全部 14 路由（tasks/board/git-history/adr/goal/doc/live/journal + 已接的 system/manager/tests/sessions/architecture/dashboard）导航统一走 renderSiteNav(current)，无手写变体残留。
- [ ] AC2: 14 路由逐一断言导航 HTML 命中 SITE_NAV_GROUPS 全部 14 项（含 /board）——验收是「全量枚举」非「测新写部分」。
- [ ] AC3: renderMobileChrome() 接入全部 14 路由（移动端统一导航入口，非仅 /tasks）。
- [ ] AC4: 对照实测：curl 全部 14 路由 → 导航一致；移动端视口（375×812）有统一汉堡导航。
- [ ] AC5: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] 全部 14 路由导航统一走 renderSiteNav + renderMobileChrome，逐路由断言命中全部 14 项（含 /board），08-16 P0 清单逐条闭合，scoped + 全量绿。

## Touches

- packages/quay/src/serve-handlers.ts（剩余 8 路由手写 nav → renderSiteNav(current) + renderMobileChrome 接入）
- packages/quay/test/（14 路由全量导航断言测试 + 移动端视口测试）
- docs/design/quay-webui-improved-2026-08-16/uploads/quaywebuiauditandproposal.md（08-16 P0 清单——验收对照正本）
- tasks/gap-webui-nav-inconsistent-routes.md（自身）
