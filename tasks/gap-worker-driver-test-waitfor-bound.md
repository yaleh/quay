---
id: gap-worker-driver-test-waitfor-bound
title: worker-driver.test.mjs waitFor 上限收紧（5s×17 / 60s×7 → 3s / 30s）——只降慢机最坏情况（Tier 1）
status: ready
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`worker-driver.test.mjs` :230 `waitFor(fn, timeoutMs = 10000, stepMs = 20)` 上限偏宽（5s×17 / 60s×7 调用点），慢机最坏情况把墙钟顶高。收紧上限（→ 3s / 30s）只降最坏情况，快乐路径早退不变。**⛔ 先量「快乐路径实际耗时」再设新上限**（硬规则 4：成本结构未知不设数值阈值）——收紧的是上限不是等待本身。

## Plan

1. 量快乐路径实际耗时（跑该文件、打印 waitFor 实际等到的最大步数）。
2. 按实测设新上限（建议 3s/30s，但以实测为准），快乐路径早退不受影响。

## Acceptance Criteria

- [ ] AC1（能取假）：waitFor 上限按实测收紧——贴「快乐路径实际耗时」读数 + 新上限 + 理由；（⛔ 无实测读数就设新值 ⇒ 假，硬规则 4）。
- [ ] AC2（能取假）：收紧后单测全绿（scoped 跑该文件）；（⛔ 红 ⇒ 假）。

## Definition of Done

waitFor 上限收紧落地（带实测读数）；AC1-AC2 全勾；scoped 全绿。

## Touches

- plugin/test/worker-driver.test.mjs（waitFor 上限 + 调用点）
- tasks/gap-worker-driver-test-waitfor-bound.md（自身）
