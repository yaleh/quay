---
id: gap-observer-registry-audit-flaky-test
title: observer-registry AC3 audit 断言 flake（并发 suite 下偶发 stale）
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

**来源**：inner 报 test-detail-load fan-in 撞 `observer-registry.test.mjs:100` AC3 断言（`audit exit 0 when every consumer is fresh` 得 `1 !== 0`）→ anti-livelock needs-human。**我实测该测试隔离跑 3/3 全绿（fail=0）** ⇒ 是并发 suite 下的 flake，非稳定回归。

**疑点（⛔ 未定根因）**：AC3 用 `makeTmp` + `fixtureRegistry` 隔离 registry 文件，但 4 个消费者（watchdog/session-liveness/topology）可能把「已跑过」的报告写到**共享位置**而非 tmp dir ⇒ 并发 suite 下其它测试/真实 monitor 的写与 AC3 的 audit freshness 判定互相污染。

## Plan

1. 定位 AC3 在并发 suite 下 stale 的来源（消费者报告落点是否共享、freshness 窗口是否太窄）。
2. 修 flake（隔离消费者报告落点，或放宽/锚定 freshness 判据）。

## Acceptance Criteria

- [ ] AC1：observer-registry AC3 在并发 suite（16 泳道）下稳定绿（⛔ 偶发 stale ⇒ 假）。

## Definition of Done

- [ ] flake 根因定位 + 并发 suite 稳定绿；AC1 全勾；land 到 develop。

## Retires

- 无（修 flake）

## Touches

- plugin/scripts/observer-registry-check.sh（audit freshness 逻辑，若根因在此）
- plugin/scripts/observer-registry.sh（若涉消费者报告落点）
- plugin/test/observer-registry.test.mjs（AC3 隔离修）
- tasks/gap-observer-registry-audit-flaky-test.md（自身）
