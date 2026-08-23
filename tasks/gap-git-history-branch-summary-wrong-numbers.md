---
id: gap-git-history-branch-summary-wrong-numbers
title: Git History 分支汇总表提交数/合并数/首提交异常（撞错分支）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager MCP 浏览器巡检投立案（已核实为真）。

**证据**：Git History「分支汇总」表对 `gap-test-detail-load-timeseries` 分支显示 提交数=481、合并数=111、首提交落地=2026-07-15 00:18:47；git 直读真实值 = 该分支自己独有 6 提交、落后 develop 3 提交（分叉点很近）。同页 3 条刚分叉兄弟分支（collapse-commits/vertical-graph/clickable-branches-window）显示 11/4/1 小个位数量级合理，唯独这条 481/111 且首提交接近仓库创世时间。**疑点**：该分支命名/查找逻辑撞到别的历史分支，或窗口计算对这条有边界情形。

## Plan

1. 定位分支汇总表对 test-detail-load 分支的查找/窗口逻辑为何撞错（命名冲突？边界？）。
2. 修数字与 git 直读一致。

## Acceptance Criteria

- [ ] AC1：分支汇总表对各分支显示提交数/合并数/首提交与 `git log` 直读一致（⛔ 481/111/2026-07-15 假 ⇒ 假）。

## Definition of Done

- [ ] 分支汇总数字异常根因定位 + 修复到与 git 直读一致；AC1 全勾；land 到 develop。

## Retires

- 无（显示修复）

## Touches

- packages/quay/src/observation.ts（readGitHistory 分支汇总计算）
- packages/quay/src/serve-handlers.ts（分支汇总表渲染）
- packages/quay/test/observation.test.mjs
- packages/quay/test/serve-handlers.test.mjs
- tasks/gap-git-history-branch-summary-wrong-numbers.md（自身）
