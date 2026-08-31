---
id: gap-sync-trigger-divergence-detection-bidirectional
title: driver 同步触发点改「检测两分支不同步即触发 + 双向」——不依赖翻转，池空也同步
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

两个 driver 同步触发点（`ready-pool-check.ts:2522` promotion-driver 晋升翻转、`driver-filters.ts:587` worker-driver needs-human 翻转）都是 `if (committed) propagateDocBranchToDevelop(root)`——**只在有翻转落地时触发，且仅 doc→develop 单向**。缺口实证 2026-08-31：池空无翻转时同步一次不跑；develop 靠 fan-in 前进 ⇒ 主检出落后 10 提交，靠人下令语义同步才收敛。

要求：两触发点改为**发现 main/manager-doc ↔ develop 不同步即触发**（分歧检测，不依赖翻转）；方向改**双向**（doc→develop 用 propagateDocBranchToDevelop；develop→doc 用 syncDevelopToDoc——后者现零生产调用者）。

## Plan

1. 两触发点改为分歧检测（`git rev-parse main/manager-doc develop` 不同即触发），不依赖 committed 翻转。
2. 方向双向：doc→develop propagateDocBranchToDevelop；develop→doc syncDevelopToDoc。

## Acceptance Criteria

- [x] AC1（能取假，机制级）：两触发点分歧检测——grep 不再 `if (committed)` 单触发，改读两 ref 分歧；（⛔ 仍只翻转触发 ⇒ 假）。
- [x] AC2（能取假，双向）：doc→develop 与 develop→doc 双向都有生产调用者（grep 两方向各 ≥1）；（⛔ 仍单向 ⇒ 假）。
- [ ] AC3（能取假，生产载体，硬规则 3c）：真实分歧触发后事件日志有记录 + 双向计数归 0——且只计实现落地之后的时间窗；（⛔ 落地后仍无事件/计数不归 0 ⇒ 假）。机制已落地（syncDocDevelopBidirectional 双向分歧检测 + doc-develop-sync-bidirectional 落痕 driver-filters.ts + driver-filters.test.mjs AC1/AC2/AC3 双向/负控制 6 条绿），落地后时间窗的生产载体记录待外部验证（生产 driver 重启后读 .quay/doc-develop-sync.jsonl 有 doc-develop-sync-bidirectional 事件 + rev-list 两向计数归 0）。（待外部）

## Definition of Done

两触发点改分歧检测（读两 ref 分歧，不依赖 committed 翻转）；doc→develop 与 develop→doc 双向接线；AC1-AC3 全勾；真实分歧触发后双向计数归 0。

## Touches

- plugin/scripts/ready-pool-check.ts（触发点改分歧检测）
- plugin/scripts/driver-filters.ts（触发点改分歧检测 + syncDevelopToDoc 双向）
- plugin/test/driver-filters.test.mjs（AC1/AC2/AC3 双向分歧检测同步测试）
- plugin/test/ready-pool-check.test.mjs（applyPromotions 每轮无条件双向同步——池空无翻转也同步测试）
- tasks/gap-sync-trigger-divergence-detection-bidirectional.md（自身）
