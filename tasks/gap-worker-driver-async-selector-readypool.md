---
id: gap-worker-driver-async-selector-readypool
title: worker-driver 循环体 spawnSync 改 spawn（selector/readyPool/liveness/git
  异步，完成作唤醒源——地板的前置，防同步调用冻住地板）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

现循环体内多处 `spawnSync`：`readyPoolCheck`（:980，timeout 120s）、`runSelectorWorker`（LLM 调用，实测约 1 分钟）、`runLivenessCheck`（:535）、多个 git（:311/:321/:448/:456/:687/:689/:693）。在「一种事件」循环里这只是慢；在有定时器的协调循环里这是**正确性问题**——一个卡住的 selector 会连定时器一起冻住，于是「地板」这张安全网本身失效（SPEC §5.7）。

## Plan

慢操作改 spawn（异步），其完成本身是一个唤醒源。协调一趟必须廉价且有界：读文件、扫进程、算 diff、至多发起一个动作。

**⛔ 顺序约束（不可交换）**：本任务必须先于或同时于 `gap-worker-driver-reconcile-interval`（3）落地——先加地板再改异步，地板被同步调用冻住 = 不生效的安全网。

## Acceptance Criteria

- [x] AC1（能取假，异步化）：循环体慢操作（readyPoolCheck / runSelectorWorker / runLivenessCheck / git）不再用 spawnSync 阻塞（⛔ 仍有 spawnSync 阻塞循环体 ⇒ 假）。
- [x] AC2（能取假，完成作唤醒源）：spawn 完成的 child exit 事件唤醒循环（⛔ 完成事件不被消费 ⇒ 假）。
- [x] AC3（能取假，廉价有界）：协调一趟有界（读文件/扫进程/算 diff/至多一个动作），一个卡住的 selector 不冻住地板（构造慢 selector，断言地板仍触发）。

## Definition of Done

循环体异步化落地 develop；AC1-3 全勾；一个卡住的 selector 场景下地板仍按 N 秒触发（AC3 复现，配合任务 3 的地板验证）。

## Touches

- plugin/scripts/worker-driver.ts（readyPoolCheck :980 / runSelectorWorker / runLivenessCheck :535 / git 调用点 spawnSync→spawn）
- plugin/test/worker-driver.test.mjs
- tasks/gap-worker-driver-async-selector-readypool.md（自身）