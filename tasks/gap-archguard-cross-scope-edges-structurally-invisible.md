---
id: gap-archguard-cross-scope-edges-structurally-invisible
title: archguard-runner 六 scope 各自分析——跨 scope 边（plugin↔packages）结构上不存在于任何一次分析
status: todo
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
2. 或（二选一，做 1 即满足 DoD）增加一次单根分析：把 `packages/*/src` + `plugin/scripts` 拷进单临时根保持相对布局后 analyze（⚠️ 已知复制陷阱：`.claude/worktrees/*` 与 `archive/**` 会被一起抄，须 root-anchored include 并核 parsed file 数与 `find` 一致）。
3. 若走单根分析，把跨 scope 的目录级环也纳入环判定并独立记录。

## Acceptance Criteria

- [ ] AC1（能取假·边界可见）每条 metrics 记录含 `crossScope` 字段且值为 `not-evaluated` + 非空 `reason`；字段缺席即假。
- [ ] AC2（可选·单根）若实现单根分析，其 `sourceFiles` 与 `find` 的非测试 `.ts` 数一致（防 `.claude/worktrees`/`archive` 混入）。
- [ ] AC3（不冒充）单根分析的目录级环读数独立记录，不与六 scope 读数合并成一个「总环数」。

## Definition of Done

metrics 记录显式声明跨 scope 边未测（或提供单根分析且读数独立）；AC1（+AC2/AC3 若走单根）勾。

## Touches

- plugin/scripts/archguard-runner.ts（HistoryRecord + main 的 crossScope 记录）
- plugin/test/archguard-structural-gate-fan-in.test.mjs（crossScope 字段断言）
- tasks/gap-archguard-cross-scope-edges-structurally-invisible.md