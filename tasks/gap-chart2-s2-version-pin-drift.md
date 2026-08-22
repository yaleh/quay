---
id: gap-chart2-s2-version-pin-drift
title: chart2-s2 测试 pin 版本漂移（develop 前移致 cov 2/3 + version-consistent pin 过期，环境红阻塞 fan-in）
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

**来源**：AC126 fan-in 红（4 条越界红之一）+ manager 裁决①「版本漂移环境红，不阻塞 AC126 接线正确性，独立小任务更新测试 pin」。

**证据（能取假）**：`experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs:205/214` cov=2/3 + version-consistent=false——develop 前移（v0.6.1..develop ahead 10）使测试硬钉的版本/cov 期望过期，与 AC124 示范轮同源环境红。

**为什么 inner 执行**：改测试期望值（版本 bump / pin 更新）属产品测试代码 → inner 域。

## Plan

1. 定位 chart2-s2 测试里硬钉的版本/覆盖率期望（:205/:214）。
2. 更新 pin 到当前 develop 的版本/覆盖率真值。
3. 跑 scoped 确认绿；fan-in（AC78 workflow）land。

## Acceptance Criteria

- [ ] AC1: chart2-s2 测试 pin 更新到当前 develop 真值，cov 断言不再因版本漂移红。
- [ ] AC2: scoped 绿（chart2-s2 测试文件 + 依赖）。

## Definition of Done

- [ ] 版本 pin 更新 + scoped 绿；AC1-2 全勾；land 到 develop。

## Touches

- experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs（版本/覆盖率 pin 更新）
- tasks/gap-chart2-s2-version-pin-drift.md（自身）
