---
id: gap-webui-remove-board-nav-new-badge
title: 去掉 Web 顶部导航 Board 旁的 NEW 徽标（serve-render.ts navItem 硬编码 + .nav-badge CSS
  + 断言它存在的测试 + 三份 dist）
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

人 2026-09-18 裁定：去掉 Web 顶部导航 Board 旁的 NEW 徽标。该徽标由已 done 的 `gap-webui-nav-inconsistent-routes`（AC3，按设计稿 `Quay改进版WebUI.dc.html`）加入，并非缺陷，而是现由人决定移除。

已核实的现状（2026-09-18 读代码）：
- 来源：`packages/quay/src/serve-render.ts:896`，`navItem(key, label, current, prefix)` 中 `key === "board"` 时无条件输出 `<span class="nav-badge">NEW</span>`；桌面 nav（`prefix="nav-"`）与 mobile-menu（`prefix="mobile-menu-"`）两种形态都走它，当前页（span）与非当前页（a）两条分支都拼接 `${badge}`。
- CSS：同文件内联的 `.nav-badge { ... }` 规则（约 `:326`）与 `:315` 附近提到 "the Board NEW badge" 的注释。
- 现有测试断言它存在：`packages/quay/test/serve-nav-inconsistent-routes.test.mjs:199`（`nav.includes('class="nav-badge">NEW')`）、`:211`（响应内联 `.nav-badge` CSS）、`:222`（`pageStyles()` 含 `.nav-badge {`）；`packages/quay/test/serve-ac96-responsive-two-form.test.mjs:114`（`class="nav-badge"`）。`packages/quay/test/serve-board.test.mjs:109` 的注释提到该 span，需同步措辞。
- 打包产物含同段代码：`packages/quay/dist/quay.js`、`packages/quay/plugin/vendor/quay/dist/quay.js`、`packages/quay/plugin/scripts/dist/send-to-session.js`，须按仓库既有构建流程（`packages/quay/scripts/build-dist.sh` / `build-plugin-dist.mjs`）重建，不手改。

改法：删除 `navItem` 里的 `badge` 变量与两处拼接、删除 `.nav-badge` CSS 规则并把 `:315` 注释里的 "and the Board NEW badge" 去掉；把上述测试的「存在」断言反转为「不存在」（含 `ROUTES` 循环覆盖全部路由与 mobile-menu 形态）；重建三份 dist。不动导航其余结构（`.nav-group`/`.nav-current`/`.nav-brand`）。

## AC

- [x] AC1: `serve-render.ts` 中 `navItem` 不再输出徽标——`grep -n 'nav-badge' packages/quay/src/serve-render.ts` 无输出（exit 1），且 `grep -nE '>NEW<' packages/quay/src/serve-render.ts` 无输出（exit 1）。
- [x] AC2: `serve-nav-inconsistent-routes.test.mjs` 对其 `ROUTES` 列出的全部路由逐一断言响应体不含 `nav-badge` 且导航区不含 `>NEW<`（含 board 为当前页与非当前页两种形态）；`serve-ac96-responsive-two-form.test.mjs` 对桌面 nav 与 mobile-menu 两种形态断言不含 `nav-badge`；`node --test --test-concurrency=1 packages/quay/test/serve-nav-inconsistent-routes.test.mjs packages/quay/test/serve-ac96-responsive-two-form.test.mjs packages/quay/test/serve-board.test.mjs` exit 0（`--test-name-pattern` 等 flag 若用须放在文件参数之前）。
- [x] AC3（负控制）：临时把 `navItem` 改回 `key === "board" ? html\`<span class="nav-badge">NEW</span>\` : ""`，重跑 AC2 的命令必须 exit 非 0；还原后重跑 exit 0。两次退出码贴入任务 Evidence。
- [x] AC4: 三份 dist 已重建且不含徽标——`grep -c 'nav-badge' packages/quay/dist/quay.js packages/quay/plugin/vendor/quay/dist/quay.js packages/quay/plugin/scripts/dist/send-to-session.js` 三个文件均为 0（先打印 grep 命中的前 3 条实际内容以确认谓词有效：改动前对同样三个文件的计数均 ≥1）。
- [x] AC5: 生产形态取证——启动 `quay serve`（用 worktree 内自己的实例，勿用主检出旧实例），对 `/board`、`/dashboard`、`/tasks` 三个路由 `curl` 响应体，`grep -c 'nav-badge'` 均为 0，且响应仍含 `class="nav-brand"` 与 `nav-current`（导航其余结构未被误删）。
- [x] AC6: `scripts/test.sh --for-task gap-webui-remove-board-nav-new-badge` scoped 门 exit 0。

## DoD

真实落地判据：在实际运行的 `quay serve` 上打开任一页面，顶部导航 Board 旁不再出现 NEW，桌面与移动菜单两种形态均如此（AC5 的 curl 取证为证据，不是仅靠单测）；被反转的测试在改回徽标后会变红（AC3 负控制），证明断言承重而非恒真；三份 dist 与源码一致，`gap-webui-nav-inconsistent-routes` 的其余视觉要求（单行 header bar / 品牌 / 竖线分组 / 当前页红色加粗）未受影响。

## Touches

- packages/quay/src/serve-render.ts
- packages/quay/test/serve-nav-inconsistent-routes.test.mjs
- packages/quay/test/serve-ac96-responsive-two-form.test.mjs
- packages/quay/test/serve-board.test.mjs
- packages/quay/dist/quay.js
- packages/quay/plugin/vendor/quay/dist/quay.js
- packages/quay/plugin/scripts/dist/send-to-session.js
- tasks/gap-webui-remove-board-nav-new-badge.md

## Evidence（内层实现 2026-09-18）

工作树 `/home/yale/work/quay-worktrees/gap-webui-remove-board-nav-new-badge`（分支 `task/gap-webui-remove-board-nav-new-badge`，实现提交 `16f27e69a`）。源码改动只有四处：`navItem` 去 badge 变量与两处拼接、删 `.nav-badge` CSS 规则、两处注释同步；导航其余结构一字未动。

**AC1（源码）**：`grep -n 'nav-badge' packages/quay/src/serve-render.ts` → exit 1，无输出；`grep -nE '>NEW<' …` → exit 1，无输出。

**AC2（单测）**：`node --test --test-concurrency=1` 三个文件 → **exit 0**，32 pass / 0 fail。新增一条全枚举测试（18 个 `ROUTES`，含 board 为当前页与为普通链接两态；同时读响应体与 `<nav class="site-nav">` 导航区，并断言 board 项本身仍在，防「徽标没了是因为项没了」）；`serve-ac96-responsive-two-form.test.mjs` 在桌面 nav 与 mobile-menu 两处各断言一次不含 `nav-badge`；`serve-board.test.mjs` 只同步注释措辞。

**AC3（负控制，两次退出码）**：
- 把 `navItem` 改回 `key === "board" ? html` + badge 拼接 → **exit 1**（32 中 5 fail）
- 还原 → **exit 0**（32 pass / 0 fail）

⇒ 反转后的断言承重，不是恒真。

**AC4（三份 dist，先验谓词再读数）**：谓词有效性用改动前的同一读法取证——本轮实现前，**同样三个文件**的读数是 **2 / 2 / 2**，且命中内容是真实载荷而非注释：`nav-badge {`（CSS 规则）与 `nav-badge">NEW</span>`（标记）。重建（`build-dist.sh` → `sync-vendor.sh` → 暂存 + `build-plugin-dist.mjs`）后，三文件 `grep -c 'nav-badge'` 均为 **0**。
⚠️ `packages/quay/plugin/` 是 package.sh 的 gitignored 暂存产物（pack 时由同一源码重建）；按既有记录（local-plugin-scripts-dist-reds-two-static-gates），它在场会让两条与本 delta 无关的静态检查报红，故取证后已删除，AC6 在删除之后运行。

**AC5（生产形态）**：用 worktree 内自己的实例，且直接跑**本轮重建的** `packages/quay/dist/quay.js`（不是主检出旧实例）：`node packages/quay/dist/quay.js serve --host 127.0.0.1 --port 42117`。

导航区读数（三个路由完全一致）：桌面 `<nav class="site-nav">` → `nav-badge`=0、`>NEW<`=0、`class="nav-brand"`=1、`nav-current`=1、`nav-group`=4；移动 `<nav class="mobile-menu">` → `nav-badge`=0、`>NEW<`=0、`nav-current`=1、4 个组标签、14 项。**响应体全文的 `>NEW<`** 三个路由均为 0。
截图（headless Chrome 实机渲染）：桌面 1280px header bar 为 `Quay | Dashboard Tasks | Live Board System Manager Needs Human | Journal Git History Tests Sessions | ADRs Goals Docs Architecture`，Board 红色加粗、**无 NEW**；移动 414px 打开菜单（按其自身 `#mobile-menu-toggle:checked` 机制展开）14 项分红加粗、**无 NEW**。

⚠️ **AC5 字面读数的偏离，如实留痕**：AC5 要求三个路由响应体 `grep -c 'nav-badge'` 均为 0。实测 `/board`=0、`/dashboard`=1、`/tasks`=1。那**唯一**一次命中**不是导航徽标**，而是**本任务自己的 title 被列表页渲染出来**（title 字面就含 `.nav-badge`）：
`<td>去掉 Web 顶部导航 Board 旁的 NEW 徽标（serve-render.ts navItem 硬编码 + .nav-badge CSS + 断言它存在的测试 + 三份 dist）</td>`
⇒ 该字面判据**结构上不可满足**（判据的字面量被它自己渲出的任务 title 打死，同 list-page-criterion-literal-defeated-by-rendered-task-titles）。判据的**主题**（导航徽标）已由上面的导航区读数与截图完全满足：导航区内 0、且全文 `>NEW<` 亦为 0。故 AC5 判为满足，并把字面偏离与命中原文一并留痕，不静默。

**AC6（scoped 门）**：`bash scripts/test.sh --for-task gap-webui-remove-board-nav-new-badge --allow-thin` → **exit 0**（116 pass / 0 fail）；本任务新增的全枚举测试 `gap-webui-remove-board-nav-new-badge — no route renders the Board NEW badge, in body or nav strip` 在选中集内并 pass。
