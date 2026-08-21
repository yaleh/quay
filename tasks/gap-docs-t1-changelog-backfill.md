---
id: gap-docs-t1-changelog-backfill
title: T1 CHANGELOG 补 v0.4/v0.5/v0.6 三节（现有 git tag 而文档零命中，指针文件过时）
status: ready
labels:
  - gap
  - docs
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：manager 2026-08-21 01:0xZ 产品化交付文档审计（人明令检查 + 立案）。缺口 T1：CHANGELOG 补三个版本。外层已核实：`git tag` 有 v0.4.0/v0.5.0/v0.6.0，但 `grep 'v0\.6\|v0\.5\|v0\.4' CHANGELOG.md` = 0 命中；顶层标题仍 `## v0.3.x`，末条 `### v0.3.12 (2026-07-24)`。`packages/quay/CHANGELOG.md` 是指针文件，自述文本还在说 "starting with v0.3.x"，**随 npm tgz 分发给用户**。

**为什么 inner 执行**：CHANGELOG 属产品文档（仓库交付面）→ inner 域。

**判据正本**：无独立正本，CHANGELOG 自身历史格式（`## v0.x.y` 顶层 + `### v0.x.y (date)` 条目 + 主题描述）。

## Plan

1. 在 CHANGELOG.md 顶层标题下补 v0.4.0 / v0.5.0 / v0.6.0 三节（含日期 + 各版本主题）。
2. 同步 packages/quay/CHANGELOG.md 指针（更新 "starting with v0.3.x" 过时文本，指向根 CHANGELOG）。
3. 验证：`grep 'v0\.6\|v0\.5\|v0\.4' CHANGELOG.md` 非零命中。

## Acceptance Criteria

- [x] AC1: `CHANGELOG.md` 顶层含 v0.4.0 / v0.5.0 / v0.6.0 三节（`grep '^## v0\.[456]' CHANGELOG.md` 命中 ≥3）。
- [x] AC2: `packages/quay/CHANGELOG.md` 指针更新（不再说 "starting with v0.3.x"；可 `grep -v 'starting with v0.3'` 验证）。
- [ ] AC3: 全量 suite 绿。

## Definition of Done

- [x] 三个已发布版本（v0.4/v0.5/v0.6）在 CHANGELOG 可查（真实输出）；指针文件已同步。

## Touches

- CHANGELOG.md（补三节）
- packages/quay/CHANGELOG.md（指针同步）
- tasks/gap-docs-t1-changelog-backfill.md（自身）
