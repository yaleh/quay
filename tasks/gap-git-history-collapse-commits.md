---
id: gap-git-history-collapse-commits
title: Git History task 分支默认折叠 commits（总数+跨度，展开查看）
status: done
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

**来源**：manager 需求分析投立案（人产品要求：task 分支默认不展开所有 commit，只显示总数+时间跨度）。

**现状**：`serve-handlers.ts` lanes 渲染 `b.commits.map(c => ...)` 逐条画圆/菱形，无折叠——500 条提交上限下是性能与信息密度双重压力源。

## Plan

1. 同一分支 commit 数超阈值时只画起止端点 + 文字标注「N commits, T 跨度」。
2. 悬停/点击展开详情。

## Acceptance Criteria

- [x] AC1：task 分支默认折叠（只显起止端点 + 总数/跨度），⛔ 每 commit 逐条渲染 ⇒ 假。
- [x] AC2：可展开查看完整 commit 列表（悬停或点击）。

## Definition of Done

- [x] task 分支折叠（起止端点 + 总数/跨度）+ 悬停/点击展开落地；AC1-2 全勾；land 到 develop。


> **手动介入记录（AC141-2 例外①）**：driver 误记 completed ⇒ 候选计算中永久排除 ⇒ 跨 round 4/5/6 两小时未重派 ⇒ inner 手动 re-trigger fan-in（判据：无记录的手动介入 ⇒ AC141-1 判假）。
## Retires

- 无（渲染折叠）

## Touches

- packages/quay/src/serve-handlers.ts（lanes 渲染折叠）
- packages/quay/test/serve-handlers.test.mjs
- tasks/gap-git-history-collapse-commits.md（自身）
