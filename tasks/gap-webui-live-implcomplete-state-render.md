---
id: gap-webui-live-implcomplete-state-render
title: web /live 渲染 implCompletedAtMs（实现中 vs 已完工待落地分栏 + 待落地时长），dashboard liveCard 升级 mini 列表
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

**来源**：manager 投立案（人核实同意）。背景：inner 当前 2 棵活跃子进程树对应 AC115+AC128 仍在实现，另 2 个任务（fan-in-fix-scope-slice / measure-trend-slice）已完工却空闲 1h47m/3h15m 等 fan-in 未获调度关注——此状态 web 上完全不可见，人只能手工查 worktree mtime + pstree 才发现。

**证据（能取假）**：`InFlightTask`（`observation.ts:82-105`）已有 `implCompletedAtMs`（第三个生命周期事件时刻，null=仍在实现 / 非null=已完工待落地）+ `minutes` + `liveness`。但 `/live` 全页渲染（`serve-handlers.ts:1413-1461`，尤其 :1414-1422 表格）**完全没用 `implCompletedAtMs`**——只画 task id/run id/started/elapsed，分不清「AC115 已耗 4h 还在写」和「slice 已耗 3h15m 早写完在等」两种性质完全不同的状态。

**为什么 inner 执行**：改 `packages/quay/src/serve-handlers.ts`（渲染层，数据已现成）→ inner 域。

## Plan

1. `/live` 表格按 `implCompletedAtMs` null/非null 分两栏或加状态标签（「实现中」vs「已完工待落地」），后者加「待落地时长」列（now − implCompletedAtMs）。
2. dashboard liveCard（`serve-handlers.ts:2454-2459`，当前纯计数一行）升级为 mini 列表（前 2-3 个在飞任务 + 状态标签），点进 `/live` 看全量。

## Acceptance Criteria

- [ ] AC1：`/live` 表格区分「实现中」（implCompletedAtMs=null）与「已完工待落地」（非null），后者展示待落地时长。
- [ ] AC2：dashboard liveCard 显示前 2-3 个在飞任务 + 状态标签（非纯计数一行），可一眼看出「有任务卡住」。

## Definition of Done

- [ ] /live 渲染 implCompletedAtMs 分栏 + 待落地时长 + liveCard mini 列表；AC1-2 全勾；land 到 develop。

## Touches

- packages/quay/src/serve-handlers.ts（渲染层）
- tasks/gap-webui-live-implcomplete-state-render.md（自身）
