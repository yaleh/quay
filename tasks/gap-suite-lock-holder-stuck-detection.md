---
id: gap-suite-lock-holder-stuck-detection
title: suite 锁持有者跨 relaunch 卡死/失联检测（释放锁 + 告警兜底，⛔ 只针对跨 relaunch 无限持有）
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

**来源**：manager 投改进建议②（次要）。

**证据（能取假）**：hub-strip 无限 relaunch 期间，suite 锁被持续持有，无任何机制自动释放或告警。**已核实既有机制**：`full-suite-runner.ts` 的 `SUITE_MAX_RUNTIME_MS`（45min）/`SUITE_SILENCE_MS`（15min）已覆盖「单次 suite 卡死」；**本任务只针对「跨 relaunch 的无限持有」那一半**——每次 relaunch 都新起进程，单次超时管不到循环本身。

**为什么 inner 执行**：suite 锁持有者检测属产品机件 → inner 域。

## Plan

1. 加「锁持有者失联/卡死 ⇒ 释放锁 + 告警」的跨-relaunch 兜底（与单次 SUITE_MAX_RUNTIME_MS/SILENCE_MS 区分，管循环本身）。
2. 告警触发时记录（谁持有、多久、释放动作）。

## Acceptance Criteria

- [ ] AC1：锁持有者跨 relaunch 失联/卡死（超循环阈值）⇒ 释放锁 + 告警（非静默持有）。
- [ ] AC2：与单次 suite 超时（SUITE_MAX_RUNTIME_MS/SILENCE_MS）不重叠——只补「跨 relaunch 循环」那一半。

## Definition of Done

- [ ] 跨-relaunch 锁持有检测 + 告警落地；AC1-2 全勾；land 到 develop。

## Touches

- .claude/workflows/fan-in-execute.js（suite 锁持有检测）
- tasks/gap-suite-lock-holder-stuck-detection.md（自身）
