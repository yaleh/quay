---
id: gap-ac96-webui-responsive-two-form
title: "AC96: 响应式从 1 断点到真·双形态——移动 375×812 首屏必须能看到第一条任务（判据=截图非 CSS 行数）"
status: todo
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

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` AC96。

**现状问题**：187 个标签的导航在 375px 下换行成 ~12 行文字墙，把任务列表挤出首屏。
**达成判据（唯一）**：桌面 1440×900 与移动 375×812 两个视口各截一次图（chrome-devtools MCP），
移动端首屏必须能看到第一条任务。⛔ 不是"加了几个 @media"（CSS 加了不等于好用，硬规则④不可取假量）。

**附带一行 bug 必须同批修掉**：`serve-handlers.ts:860` 内联 `style="white-space:normal"` 覆盖
`.label-nav-wrap` 的 `white-space:nowrap`——设计意图和实现自相矛盾（审计 §1.4-3）。

## Acceptance Criteria

- [ ] AC1: 375×812 视口截图首屏可见第一条任务（移动端首屏不被导航墙挤出）。
- [ ] AC2: 1440×900 视口截图正常（桌面形态）。
- [ ] AC3: serve-handlers.ts:860 的 white-space 内联覆盖修正（同 AC97③ 交叉引用）。

## Definition of Done

- [ ] 双视口截图达成（AC1+AC2），white-space 覆盖同批修掉（AC3）。

## Touches

- packages/quay/src/serve-handlers.ts（white-space 覆盖 + 移动导航布局）
- packages/quay/src/（响应式样式——sc-if isDesktop/isMobile + mobileMenuOpen）
- packages/quay/test/（web 测试）
- tasks/gap-ac96-webui-responsive-two-form.md（自身）
