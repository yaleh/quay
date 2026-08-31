---
id: gap-worker-driver-test-merge-driver-tests
title: worker-driver 合并同形 driver 测试——spawn 33→~17（复用已启动 driver 多断言）（Tier 2）
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

`worker-driver.test.mjs`（~157s）里 22 个 `spawnResident` + 11 个 `runDriver` 是主成本（~33 次真 driver spawn，占 40–50%）。合并同形场景 / 复用已启动 driver 多断言，spawn 数 33→~17，墙钟显著下降（估 ~10–25s/轮）。

## Plan

1. 枚举 33 次真 driver spawn 的调用点，识别同形场景（同 driver 配置、不同断言）。
2. 合并为「一次 spawn + 多断言」，复用已启动 driver。

## Acceptance Criteria

- [ ] AC1（能取假）：真 driver spawn 数下降——grep 该文件 spawnResident/runDriver 调用数较基线下降（贴前后计数）；（⛔ 未降 ⇒ 假）。
- [ ] AC2（能取假）：合并后断言仍绿（scoped 全绿，⛔ 不删测试换时间）；（⛔ 任一条断言丢失/红 ⇒ 假）。

## Definition of Done

同形 driver 测试合并落地；AC1-AC2 全勾；scoped 全绿 + 墙钟下降且无断言丢失。

## Touches

- plugin/test/worker-driver.test.mjs（同形 driver 测试合并）
- tasks/gap-worker-driver-test-merge-driver-tests.md（自身）

## Needs-Human

**执行 2026-08-31T03:05:14.457Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
