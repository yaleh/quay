---
id: gap-ac100-webui-detail-pages-modernist-tokens
title: "AC100: 风格一致性覆盖设计没画的既有详情页——/adr/:id /goal/:id /doc/:id 共用 Modernist token"
status: ready
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

- [ ] AC1: 三详情页与 15 设计视图共用同一样式来源——Modernist token（`docs/design/.../_ds/modernist-*/styles.css`
      的 `--color-*` / `--font-*` / `--space-*` / `--radius-*`）。**取假**：渲染三详情页的代码段
      `grep -cE '#[0-9a-fA-F]{6}'` 命中写死十六进制 >0 即假（现状全站写死十六进制，正是要消灭的）。
- [ ] AC2: 三详情页在 375×812 视口下可读（与 AC96 同套截图流程，同判据形态）。

## Definition of Done

- [ ] 三详情页共用 Modernist token（AC1），移动端可读（AC2）。

## Touches

- packages/quay/src/serve-handlers.ts（/adr/:id /goal/:id /doc/:id 渲染——token 化）
- docs/design/quay-webui-improved-2026-08-16/_ds/modernist-*/styles.css（token 来源，只读参考）
- packages/quay/test/（web 测试）
- tasks/gap-ac100-webui-detail-pages-modernist-tokens.md（自身）
