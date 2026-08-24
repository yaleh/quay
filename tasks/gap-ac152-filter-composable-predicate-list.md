---
id: gap-ac152-filter-composable-predicate-list
title: AC152 Filter 可组合谓词列表（两 driver 共用，⛔ 非各 kind 私有分支）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-worker-driver-no-record-on-abnormal-death
  - gap-ac141-execution-face-inner-manual-retirement
  - gap-direct-to-develop-check-reflog-to-revlist
  - gap-git-history-branch-summary-wrong-numbers
  - gap-launch-script-worker-cap-broken
---

**type:** execution

## Proposal

**来源**：manager 2026-08-23 架构裁定（判据正本 `orchestration/manager-phase-goal.md` `### AC152`，⛔ 不在此复制；设计正本 `orchestration/SPEC-unified-driver-architecture-2026-08-23.md` §2.1「Filter 是一个列表」）。

**缺口（实测，两个 driver 各有一个随机子集）**：
```
notInFlight            worker 有       promotion 无
depsSatisfied          ⛔ 两个都无     ← ac138 白烧 15 分钟
touchesDisjoint        ⛔ 两个都无     ← Git-History 群组撞 serve-handlers.ts 的风险
retryCapNotExhausted   promotion 有    worker 无
notNeedsHuman          promotion 有    worker 无
```
⇒ 同一个缺失的抽象，今天有两种表现（ac138 白跑一轮 · Touches 冲突风险）。

**⊢ 排期注记**：本任务属下一阶段（架构地基），⛔ 现在只立案不派发——`depends_on` 即 SPEC §0 的排期锁（AC142 系列收口），不是输出依赖。推进顺序 manager 建议 AC152+AC153 先做（纯函数、可单测、无进程边界问题，且当下就在造成损失）。⛔ AC151/AC152/AC153 三者都动 kernel/filter 同一片区域，**不并发**，按 AC152→AC153→AC151 单条推进。

## Plan

1. 把五个谓词做成**一个列表里的元素**（`notInFlight`/`depsSatisfied`/`touchesDisjoint`/`retryCapNotExhausted`/`notNeedsHuman`），两个任务处理型 kind 共用。
2. worker-driver / promotion-driver 派发前过滤改为消费该列表（⛔ 不各写一遍）。

## Acceptance Criteria

判据正本在 `orchestration/manager-phase-goal.md` `### AC152`（⛔ 取假形态不在此复制）。

- [ ] AC1：五个谓词是可组合列表元素，promotion/worker 两 driver 共用；给两个 driver 同时新增一个谓词只需改一处（⛔ 需改两处以上 ⇒ 假）；取假见正本 AC152。

## Definition of Done

- [ ] Filter 谓词列表单一实现 + 两 driver 共用落地；AC1 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/driver-filters.ts（新：可组合谓词列表单一实现）
- plugin/scripts/worker-driver.ts（派发前过滤改消费 filter 列表）
- plugin/scripts/promotion-driver.ts（派发前过滤改消费 filter 列表）
- plugin/scripts/ready-pool-check.ts（depsSatisfied/touchesDisjoint 谓词复用）
- plugin/test/driver-filters.test.mjs（新 test）
- plugin/test/worker-driver.test.mjs（test）
- plugin/test/promotion-driver.test.mjs（test）
- tasks/gap-ac152-filter-composable-predicate-list.md（自身）
