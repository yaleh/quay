---
id: gap-archguard-cross-scope-edges-structurally-invisible
title: archguard-runner 六 scope 各自分析——跨 scope 边（plugin↔packages）结构上不存在于任何一次分析
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

`archguard-runner.ts` 对六个 scope 各自跑 `archguard analyze -s <source>`。多 source 时每 source 成一个 scope、无跨 scope 边（已知设计：single-root copy 才能拿到 plugin↔packages 边）。因此 `plugin/scripts` 与 `packages/*/src` 之间的 import 边**不存在于任何一次分析**——当前「无环」结论对跨 scope 边是无条件成立，而非测得为 0。

## Plan

1. 记录 `crossScope: "not-evaluated"` + `reason`（六 scope 各自独立 ⇒ 跨 scope 边未测）入每条 metrics 记录。
2. 单根分析（把 `packages/*/src` + `plugin/scripts` 拷进单临时根保持相对布局后 analyze）是可选后续、不在本任务范围——先让「未测」显式，再谈真正测到跨 scope 边（⚠️ 已知复制陷阱 `.claude/worktrees`/`archive` 会被一起抄，留作后续任务）。

## Acceptance Criteria

- [x] AC1（能取假·边界可见）每条 metrics 记录含 `crossScope` 字段且值为 `not-evaluated` + 非空 `reason`；字段缺席即假。

## Definition of Done

metrics 记录显式声明跨 scope 边未测（crossScope=not-evaluated + reason）；AC1 勾。

## Touches

- plugin/scripts/archguard-runner.ts（HistoryRecord + main 的 crossScope 记录）
- plugin/test/archguard-structural-gate-fan-in.test.mjs（crossScope 字段断言）
- tasks/gap-archguard-cross-scope-edges-structurally-invisible.md