---
id: gap-webui-cross-task-blocking-visibility
title: web 展示跨任务阻塞关系（Touches 交集 + depends_on 链 → blocks/blockedBy，谁挡谁可查）
status: ready
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

**来源**：manager 投立案（人核实同意）。背景：`retry-cap`+`lock-stuck` 两个 ready 任务被 outer 判「Touches 与 slice 重叠」而 deferred（tick-log 09:08Z 等条目），此阻塞关系只存在于 outer 的 tick-log 散文里，web 上查不到。

**证据（能取假）**：`observation.ts` 全文无任何函数计算跨任务 Touches 冲突或 `depends_on` 阻塞链——`InFlightTask` 没有 `blocks`/`blockedBy` 字段。而任务 frontmatter 已有 `depends_on`（145 个任务在用），Touches 集合也在盘上可读。

**为什么 inner 执行**：改 `observation.ts`（新计算函数）+ `serve-handlers.ts`（渲染）→ inner 域。

## Plan

1. `observation.ts` 新增计算：对每个在飞任务 `## Touches` 集合，与 ready/todo 池每任务 `## Touches` 做交集，算「谁挡谁」；`depends_on` 链同理（frontmatter 已有字段）。
2. `InFlightTask` 加 `blocks`/`blockedBy` 字段。
3. `/live` 或独立视图渲染「任务 X 正在阻塞 [任务 Y, 任务 Z]」。

## Acceptance Criteria

- [ ] AC1：`InFlightTask` 有 `blocks`/`blockedBy` 字段，由 Touches 交集 + depends_on 链算出（机械可核）。
- [ ] AC2：`/live`（或独立视图）展示「任务 X 阻塞 [Y, Z]」的跨任务阻塞关系（当前只在 tick-log 散文里，web 可查）。

## Definition of Done

- [ ] 跨任务阻塞关系计算（blocks/blockedBy 字段）与 /live 渲染展示落地；AC1-2 全勾；land 到 develop。

## Touches

- packages/quay/src/observation.ts（新计算函数 blocks/blockedBy）
- packages/quay/src/serve-handlers.ts（渲染）
- tasks/gap-webui-cross-task-blocking-visibility.md（自身）
