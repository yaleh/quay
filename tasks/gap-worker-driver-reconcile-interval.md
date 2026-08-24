---
id: gap-worker-driver-reconcile-interval
title: worker-driver 加定时器地板 --reconcile-interval（至少每 N 秒协调一次，边沿事件全丢也降级「慢但正确」而非静默停摆）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

今日 1h48m 停摆的根因是边沿触发 + 存储决策（stopReason latch，SPEC §5.0/5.5）。当前循环只有一种事件（worker 退出）且无地板，任何边沿事件源失效（Monitor 死、CronCreate 消失——今日实测哨兵读不出锚消失）⇒ 静默停摆。**加定时器地板后，任何边沿事件源失效 ⇒ 系统降级为「慢但正确」而非「静默停摆」**。

## Plan

driver 进程内加 `--reconcile-interval <s>`（CLI `quay driver ... --reconcile-interval <s>`，缺省保守）。**⛔ 不用 CronCreate**（会话级、会话死即死、7 天过期）。定位 = **「至少每 N 秒协调一次，哪怕所有边沿事件都丢了」**，不是「每 N 秒做一次事」。§2.2 已指出 `routine-scheduler.ts` 的 `interval:<N>m` 判定可复用——不要重新发明定时器。

**⛔ 顺序约束（不可交换）**：本任务必须在地板不被同步调用冻住的前提下才成立——见 `gap-worker-driver-async-selector-readypool`（4），**4 必须先于或同时于 3 落地**。先加地板再改异步，地板被同步调用冻住 = 一张不生效的安全网，比没有更贵（硬规则 3b：恒绿的检查是假保证）。

## Acceptance Criteria

- [ ] AC1（能取假，地板触发）：driver 进程内定时器每 N 秒触发一次协调（⛔ 用 CronCreate/会话级机制 ⇒ 假；⛔ 仅 --json 才可观测 ⇒ 假——须生产可见载体）。
- [ ] AC2（能取假，降级非停摆）：构造「所有边沿事件源失效」场景，断言 driver 仍在 N 秒内重算 ready 池并派发（⛔ 停摆等边沿事件 ⇒ 假）。

## Definition of Done

--reconcile-interval 地板落地 develop；AC1-2 全勾；一个无任何边沿事件的场景下 driver 仍按 N 秒协调派发（AC2 复现）。

## Touches

- plugin/scripts/worker-driver.ts（协调循环地板 + --reconcile-interval 解析 + 循环体 spawnSync→spawn 异步化〔任务 4 的前置〕）
- plugin/scripts/routine-scheduler.ts（复用 interval 判定，不新造——import isDue）
- packages/quay/src/cli/driver.ts（quay driver --reconcile-interval 接线）
- plugin/scripts/promotion-driver-launch.sh（supervisor 解析 --reconcile-interval 并透传给 worker driver——CLI 接线必经此脚本，原 Touches 漏列）
- plugin/test/worker-driver.test.mjs
- tasks/gap-worker-driver-reconcile-interval.md（自身）