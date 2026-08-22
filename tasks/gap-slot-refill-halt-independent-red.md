---
id: gap-slot-refill-halt-independent-red
title: slot-refill + .halt 独立红（自含 fixture 测 .halt 阻断逻辑，fixture 假设漂移 vs 机件变更——阻塞 fan-in）
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

**来源**：AC126 fan-in 红（4 条越界红之二）+ manager 裁决②「独立红，非 chart2 环境红连带」。

**证据（能取假）**：`slot-refill`「a dispatchable candidate and free slots ⇒ refill」+ `.halt`「removing .halt unblocks dispatch」两条失败——二者用**自含 fixture** 测 slot-refill.ts 的 .halt 阻断逻辑，不读真实 repo、不依赖版本。根因需 inner 单独查：**fixture 假设漂移** vs **slot-refill.ts 机件变更**，二者都可能。

**为什么 inner 执行**：查根因 + 修（机件或 fixture）属产品代码/测试 → inner 域。

## Plan

1. 复现两条失败（slot-refill + .halt 测试），定位是 fixture 假设漂移还是 slot-refill.ts 机件变更。
2. 修根因（改 fixture 或改机件，看哪个是漂移源）。
3. 跑 scoped 确认绿；fan-in（AC78 workflow）land。

## Acceptance Criteria

- [ ] AC1: 定位 slot-refill + .halt 两条失败的根因（fixture 漂移 vs 机件变更），并修复。
- [ ] AC2: scoped 绿（slot-refill + .halt 测试文件 + 依赖）。

## Definition of Done

- [ ] 根因定位 + 修复 + scoped 绿；AC1-2 全勾；land 到 develop。

## Touches

- plugin/scripts/slot-refill.ts（若机件变更）
- plugin/test/slot-refill-heartbeat.test.mjs（若 fixture 漂移，实际文件名 inner 定）
- tasks/gap-slot-refill-halt-independent-red.md（自身）
