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

> **⛔ DEAD-CODE 注记（manager wiring 审计 2026-08-23）**：本任务实现提交 `0ce7cd5a` 改的是旧 `renderGitHistorySvg` 函数，但同日晚 `gap-git-history-vertical-graph-thirdparty-lib`（`ca4f1bc5`/`d7cb9b89`）把整个 `/git-history` 页重写为 D3、`renderGitHistorySvg` 被整体删除（`grep -rn renderGitHistorySvg packages/quay/src/` 零命中）。本任务的折叠行为现由 vertical-graph 自身的 `layoutGitGraph(collapsed:true)` + D3 点击展开代偿满足，本任务交付物为死代码（只剩 `serve-handlers.ts:270-271` 孤儿 CSS 规则，生成代码已不存在）。行为已覆盖，⛔ 无需重新落折叠逻辑。

## Touches

- packages/quay/src/serve-handlers.ts（lanes 渲染折叠）
- packages/quay/test/serve-handlers.test.mjs
- tasks/gap-git-history-collapse-commits.md（自身）
