---
id: gap-ac100-webui-detail-pages-modernist-tokens
title: "AC100: 风格一致性覆盖设计没画的既有详情页——/adr/:id /goal/:id /doc/:id 共用 Modernist token"
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` AC100。

**差集实读**：设计 sc-if 视图【没有】ADR 详情 / Goal 详情 / Doc 详情（只画了列表页）；
但当前实现里三个详情路由存在且在用：`/adr/:id`（supersedes/supersededBy 双向渲染）、
`/goal/:id`（kind/status 过滤、evidence 最近 verdict）、`/doc/:id`。
⇒ 改版结果若是 15 个新页面一套样式、3 个详情页停旧样式 = 风格分裂。

## Acceptance Criteria

- [x] AC1: 三详情页与 15 设计视图共用同一样式来源——Modernist token（`docs/design/.../_ds/modernist-*/styles.css`
      的 `--color-*` / `--font-*` / `--space-*` / `--radius-*`）。**取假**：渲染三详情页的代码段
      `grep -cE '#[0-9a-fA-F]{6}'` 命中写死十六进制 >0 即假（现状全站写死十六进制，正是要消灭的）。
- [x] AC2: 三详情页在 375×812 视口下可读（与 AC96 同套截图流程，同判据形态）。

## Definition of Done

- [x] 三详情页共用 Modernist token（AC1），移动端可读（AC2）。

## Evidence

**AC1 — 共用 Modernist token，渲染代码零写死十六进制**
- 实现：`packages/quay/src/serve-handlers.ts` 新增 `modernistStyles()`——读取产品 canonical 副本
  `packages/quay/src/webui-modernist.css`（**逐字节等于**设计 `_ds/modernist-*/styles.css`，同源由测试钉死）——
  + `detailStyles()`（仅 `var(--*)` token，零 hex）。三个详情 handler 由 `pageStyles()` 换成
  `modernistStyles() + detailStyles()`；`goalEvidenceCell` 的内联 `style="color:#1a7f37/#cf222e"` 换成
  `.verdict-pass` / `.verdict-fail` class（token 定义）。
- 判据①（取假面）：三详情 handler 代码段 hex 命中 = 0（复算：`webui-modernist-sync.test.mjs` AC100(c)
  对 `serve-handlers.ts` 三个 handler 函数体做 `/#[0-9a-fA-F]{6}/g`，断言 []）：
  ```
  handleAdrDetail   -> hex hits = 0
  handleGoalDetail  -> hex hits = 0
  handleDocDetail   -> hex hits = 0
  ```
- 判据①（同源面）：`webui-modernist-sync.test.mjs` AC100(a) 断言产品副本与设计源**逐字节相同**，
  且含 `--color-bg`/`--font-heading`/`--space-1`/`--radius-md`。
- 渲染面：AC100(b) 三测试断言 `/adr/:id` `/goal/:id` `/doc/:id` 页面含 `var(--color-` 与 `--color-bg`，
  且不含旧 hex accent `#0066cc`、不含旧内联 verdict hex。

**AC2 — 375×812 移动端可读（真实截图，同 AC96 截图流程）**
- 复现：demo workspace 起 serve 后，对三详情路由各截一图：
  ```
  google-chrome --headless=new --disable-gpu --hide-scrollbars --window-size=375,812 \
    --virtual-time-budget=3000 --screenshot=<out.png> http://127.0.0.1:8123/<page>
  ```
- 截图（375×812 真实视口，commit 于 design evidence 目录）：
  `docs/design/quay-webui-improved-2026-08-16/evidence/ac100-mobile-375x812/{adr-ADR-044,goal-AC-100,doc-DOC-001}-mobile-375x812.png`
- 像素核验（node zlib 解码，可复算）：三页均 ≈94% 浅底（`--color-bg` 体系）、1.3–1.8% 深色正文、
  含精确 accent `#ec3013`（token 生效）→ 内容可读，非空白页。

**测试**：`scripts/test.sh --for-task gap-ac100-webui-detail-pages-modernist-tokens --allow-thin`
→ 85/85 绿；全量 web 集（serve-*.test.mjs + web-ui-browser + webui-modernist-sync）→ 38 pass / 0 fail /
1 skip（live-GitHub 预置跳过）；ts-typecheck gate 5/5 绿。

## Touches

- packages/quay/src/serve-handlers.ts（/adr/:id /goal/:id /doc/:id 渲染——token 化）
- packages/quay/src/webui-modernist.css（新增——设计 styles.css 的逐字节产品副本，token 来源）
- packages/quay/test/webui-modernist-sync.test.mjs（新增——AC1 同源/零hex 机械判据 + AC2 渲染断言）
- docs/design/quay-webui-improved-2026-08-16/_ds/modernist-*/styles.css（token 来源，只读参考）
- docs/design/quay-webui-improved-2026-08-16/evidence/ac100-mobile-375x812/（AC2 截图证据）
- packages/quay/test/（web 测试）
- tasks/gap-ac100-webui-detail-pages-modernist-tokens.md（自身）
