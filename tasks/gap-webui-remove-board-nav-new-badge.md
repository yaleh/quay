---
id: gap-webui-remove-board-nav-new-badge
title: 去掉 Web 顶部导航 Board 旁的 NEW 徽标（serve-render.ts navItem 硬编码 + .nav-badge CSS
  + 断言它存在的测试 + 三份 dist）
status: todo
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

- [ ] AC1: `serve-render.ts` 中 `navItem` 不再输出徽标——`grep -n 'nav-badge' packages/quay/src/serve-render.ts` 无输出（exit 1），且 `grep -nE '>NEW<' packages/quay/src/serve-render.ts` 无输出（exit 1）。
- [ ] AC2: `serve-nav-inconsistent-routes.test.mjs` 对其 `ROUTES` 列出的全部路由逐一断言响应体不含 `nav-badge` 且导航区不含 `>NEW<`（含 board 为当前页与非当前页两种形态）；`serve-ac96-responsive-two-form.test.mjs` 对桌面 nav 与 mobile-menu 两种形态断言不含 `nav-badge`；`node --test --test-concurrency=1 packages/quay/test/serve-nav-inconsistent-routes.test.mjs packages/quay/test/serve-ac96-responsive-two-form.test.mjs packages/quay/test/serve-board.test.mjs` exit 0（`--test-name-pattern` 等 flag 若用须放在文件参数之前）。
- [ ] AC3（负控制）：临时把 `navItem` 改回 `key === "board" ? html\`<span class="nav-badge">NEW</span>\` : ""`，重跑 AC2 的命令必须 exit 非 0；还原后重跑 exit 0。两次退出码贴入任务 Evidence。
- [ ] AC4: 三份 dist 已重建且不含徽标——`grep -c 'nav-badge' packages/quay/dist/quay.js packages/quay/plugin/vendor/quay/dist/quay.js packages/quay/plugin/scripts/dist/send-to-session.js` 三个文件均为 0（先打印 grep 命中的前 3 条实际内容以确认谓词有效：改动前对同样三个文件的计数均 ≥1）。
- [ ] AC5: 生产形态取证——启动 `quay serve`（用 worktree 内自己的实例，勿用主检出旧实例），对 `/board`、`/dashboard`、`/tasks` 三个路由 `curl` 响应体，`grep -c 'nav-badge'` 均为 0，且响应仍含 `class="nav-brand"` 与 `nav-current`（导航其余结构未被误删）。
- [ ] AC6: `scripts/test.sh --for-task gap-webui-remove-board-nav-new-badge` scoped 门 exit 0。

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
