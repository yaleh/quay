---
id: gap-main-manager-doc-doc-only-ff-only-tracking
title: main/manager-doc 写面 + 机械同步 ff-only（不静默 merge）+ 分叉 guard——写面保留、可靠同步
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**人 2026-08-31 裁定反转**：写面保留 main/manager-doc——在 main/manager-doc 修改任务状态是常见的（最典型 needs-human→其他状态），「ref-level 直落 develop」方向弃用。可接受分叉、可接受同步损失 main/manager-doc 的变更，但必须有持续同步机制且必须同步成功。

本任务是**机械同步半边**（父 = gap-doc-develop-sync 语义兜底核心）：develop→doc 同步改 **ff-only（不静默 merge）**，分叉即 **guard 报红**（非静默 catch，硬规则 3b）。语义兜底（分叉后怎么融、升级 Claude Code）归父任务。

**实证**：`propagateDocBranchToDevelop`（driver-filters.ts:207）fallback `git merge develop` 每次冲突，近 30 天 1795 次 `Merge branch 'develop' into main/manager-doc` 全由其产生；propagate 静默失败（`: void` + `catch(_){}` 全吞）⇒ 主检出落后 develop 53 提交、4 任务状态分叉。

## Plan

1. develop→doc 同步从 propagate merge-fallback 改为 `git merge --ff-only develop`；非 ff 时报「无法 ff-only 同步」（独立取值，非「同步成功」同形，硬规则 3b）。
2. 立分叉 guard：main/manager-doc 与 develop 分叉即报红（不静默）。
3. 负控制：造一次分叉（doc 有 develop 没有的提交）验证 guard 报红、ff-only 不 merge-fallback。

## Acceptance Criteria

- [x] AC1（能取假，ff-only）：develop→doc 同步不再 merge-fallback——grep 无 `git merge develop` 兜底；非 ff 时报「无法 ff-only 同步」（独立取值）；（⛔ 仍静默 catch ⇒ 假）。
- [x] AC2（能取假，guard）：main/manager-doc 与 develop 分叉即报红——造一次分叉验证 guard 报红；（⛔ 分叉不报 ⇒ 假）。
- [x] AC3（能取假，负控制）：一次真实 develop→doc 同步后 `git rev-parse main/manager-doc develop` 两 ref 相等（同一次 commit）；（⛔ 仍分叉 ⇒ 假）。
- [ ] AC4（能取假，生产载体，硬规则 3c）：syncDevelopToDoc 有 ≥1 非测试调用者（promotion-driver 每轮启动前 syncDevelopToDoc(root)）+ 成功同步（synced）亦落痕 `doc-develop-sync-ff-synced` 到 `.quay/doc-develop-sync.jsonl`——读生产载体有落地后时间窗的记录；（⛔ 生产载体无记录 / 仅测试调用 ⇒ 假）。

## Definition of Done

develop→doc 同步改 ff-only（不静默 merge）；分叉 guard 接线；AC1-AC4 全勾；一次真实同步 + 一次分叉负控制 + syncDevelopToDoc 生产真实（读 .quay/doc-develop-sync.jsonl）。

## Touches

- plugin/scripts/driver-filters.ts（加 syncDevelopToDoc 机械 ff-only + docBranchForkedFromDevelop 分叉 guard + synced 落痕）
- plugin/scripts/promotion-driver.ts（AC4 非测试调用者：每轮启动前 syncDevelopToDoc(root)）
- plugin/test/driver-filters.test.mjs（AC1/AC2/AC3 负控制测试 + AC4 非测试调用者/生产载体落痕测试）
- CLAUDE.md（分支同步纪律：写面保留 main/manager-doc + 机械 ff-only）
- tasks/gap-main-manager-doc-doc-only-ff-only-tracking.md（自身）
