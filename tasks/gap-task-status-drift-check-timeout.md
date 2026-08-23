---
id: gap-task-status-drift-check-timeout
title: task-status-drift-check.ts 超时 8s fail-open 排查
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

**来源**：manager web 巡检投立案（代码级核实）。

**证据**：Board 页顶部自曝 `落地: task-status-drift-check.ts · 读取超时 — 超过 8000ms 未完成 (fail-open)`，导致全部 1387 行「落地」列恒 "—"。页面诚实报了故障（硬规则 3b 正确做法，没假装 "—" 是「未落地」），但故障本身没人跟进。

## Plan

1. 排查 `task-status-drift-check.ts` 为何稳定超 8s（数据量增长到 1387 条后线性扫描变慢？还是别的原因）。
2. 修复到 <8s（或优化算法/加缓存）。

## Acceptance Criteria

- [x] AC1：`task-status-drift-check.ts` 在 1387 条任务下执行 <8s（⛔ 稳定超时 fail-open ⇒ 假）。
- [x] AC2：Board 页「落地」列显示真实判断结果（⛔ 恒 "—" ⇒ 假）。

## Definition of Done

- [x] 超时根因定位 + 修复到 <8s + 落地列显示真实结果；AC1-2 全勾；land 到 develop。

## Retires

- 无（性能修复）

## Touches

- plugin/scripts/task-status-drift-check.ts（超时根因）
- experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts（byte-identical mirror，AC1 测试强制，同步改）
- plugin/test/task-status-drift-check.test.mjs（性能测试）
- tasks/gap-task-status-drift-check-timeout.md（自身）
