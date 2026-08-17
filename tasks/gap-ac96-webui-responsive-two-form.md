---
id: gap-ac96-webui-responsive-two-form
title: "AC96: 响应式从 1 断点到真·双形态——移动 375×812 首屏必须能看到第一条任务（判据=截图非 CSS 行数）"
status: done
labels:
  - gap
  - mechanism
  - priority:p1
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` AC96。

**现状问题**：187 个标签的导航在 375px 下换行成 ~12 行文字墙，把任务列表挤出首屏。
**达成判据（唯一）**：桌面 1440×900 与移动 375×812 两个视口各截一次图（chrome-devtools MCP），
移动端首屏必须能看到第一条任务。⛔ 不是"加了几个 @media"（CSS 加了不等于好用，硬规则④不可取假量）。

**附带一行 bug 必须同批修掉**：`serve-handlers.ts:860` 内联 `style="white-space:normal"` 覆盖
`.label-nav-wrap` 的 `white-space:nowrap`——设计意图和实现自相矛盾（审计 §1.4-3）。

## Acceptance Criteria

- [x] AC1: 375×812 视口截图首屏可见第一条任务（移动端首屏不被导航墙挤出）。
- [x] AC2: 1440×900 视口截图正常（桌面形态）。
- [x] AC3: serve-handlers.ts 的 white-space 内联覆盖修正（同 AC97③ 交叉引用；fae3322f 已移除内联覆盖，本任务验证 + 测试钉住）。

## Definition of Done

- [x] 双视口截图达成（AC1+AC2），white-space 覆盖同批修掉（AC3）。

## Evidence

- **实现**：`serve-handlers.ts` 响应式两形态——
  - **移动形态（sc-if isMobile / mobileMenuOpen，零客户端 JS = AC4 不变式）**：新增 `renderMobileChrome()`，渲染汉堡头（`<label class="mobile-menu-burger">`）＋ 全屏导航菜单（`<nav class="mobile-menu">`，内含 `renderSiteNav()` 全 15 视图导航）。菜单由隐藏 checkbox 的 `:checked` 状态开关（纯 CSS `input:checked ~ .mobile-menu`，无 `<script>`）；桌面 >600px 时 `.mobile-chrome { display:none }` 零开销。
  - **标签导航芯片化（设计 isMobile chips）**：`.label-nav-wrap` 从「nowrap 文本行」升级为 flex 芯片容器（`.label-chip` 胶囊，token 色）；桌面 `flex-wrap:wrap` 可换行、移动 `flex-wrap:nowrap; overflow-x:auto` 单行横滚。同时修掉审计发现的**无效 HTML bug**——`<details>` 原嵌在 `<p class="meta">` 内，HTML 解析器把 `<p>` 截断、details 独自一行（标签导航 2 块、88px）；现 `<details class="label-chip label-chip-more">` 是 flex 直接子项（单行 28px）。
  - **桌面 `.site-nav` 行**：加 `class="meta site-nav"`，移动端隐藏（链接进汉堡菜单）；Filter/Sort 行加 `class="list-nav"`，移动端单行横滚。
- **AC1（375×812，playwright 实测）**：首行任务 `top=385px`（视口 812px，`firstRowVisible=true`）；pre-table 预算 335px→**174px**；`.label-nav-wrap` 单行横滚（scrollWidth 2795 > clientWidth 351，height 28px）。截图 `packages/quay/test/fixtures/ac96-mobile-375x812.png`。
- **AC2（1440×900，playwright 实测）**：桌面形态正常——`.mobile-chrome` display:none、`.site-nav` 显示、`.label-nav-wrap` 换行芯片；首行任务 `top=481px`。截图 `packages/quay/test/fixtures/ac96-desktop-1440x900.png`。
- **AC3（white-space 覆盖）**：`serve-handlers.ts` 全文件 `grep -n "white-space:normal"` 命中 0（fae3322f 已移除内联 `style="white-space:normal"`）；测试断言列表页响应体无 `style="white-space:normal"` 字面量。
- **两形态可切换**：点击汉堡 label 实测菜单 `display:none → block`（截图 `packages/quay/test/fixtures/ac96-mobile-menu-open-375x812.png`），再点关闭。
- **测试**：新增 `packages/quay/test/serve-ac96-responsive-two-form.test.mjs`（7 条：mobile chrome 结构 / site-nav+list-nav+chips / AC3 white-space / details-非-p-嵌套 / AC96 CSS 前提 / renderMobileChrome / AC102 保持零 hex）。既有 `serve.test.mjs`（QX-043 UQ-006）＋ `serve-ac95-views` ＋ `serve-ac102-modernist-views` ＋ `webui-modernist-sync` 全绿（36 测试 0 失败）。
- **AC102 保持**：新增 CSS 全部 `var(--color-*)` token（`grep -cE '#[0-9a-fA-F]{6}' serve-handlers.ts` = 0）；列表页响应仍内联 `--color-bg` token 表。

## Touches

- packages/quay/src/serve-handlers.ts（white-space 覆盖 + 移动导航布局）
- packages/quay/src/（响应式样式——sc-if isDesktop/isMobile + mobileMenuOpen）
- packages/quay/test/（web 测试）
- packages/quay/test/serve-ac96-responsive-two-form.test.mjs（AC96 新增测试）
- packages/quay/test/fixtures/ac96-*.png（双视口 + 菜单开截图证据）
- tasks/gap-ac96-webui-responsive-two-form.md（自身）
