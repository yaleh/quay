---
id: gap-suite-leak-scan-ol-scd-g-teardown-slow
title: leak-scan 越界 flake：ol-scd-g teardown 超 10000ms reap-wait 窗口 ⇒ 4 轮假红（慢
  teardown 竞态，非永久泄漏）
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

worker 报 fan-in 二轮 suite 全绿（3320 pass / 0 fail / 3 skipped）但被 suite 尾 leak-scan 越界 flake 挡下：`ol-scd-g`（session-liveness.test.mjs:283 makeHermeticProbe）teardown 慢、超 10000ms reap-wait 窗口 ⇒ scan 判红；4 轮同形（.prev -xie53B、本轮 -D22itv 均 ol-scd-g）⇒ defer anti-livelock 兜底停重跑。复核时残留已消亡（慢 teardown 竞态，非永久泄漏）。非 tmux-stale 任务回归（session-liveness- 前缀在其扩展前就在 scan scope）。

## Plan

ol-scd 家族 4 gap 已 done，这是新实例——要么 teardown 提速，要么 reap-wait 10000ms 在当前 16-lane 负载下放宽（读宿主：lane 数/负载越高 teardown 越慢，写死 10000ms 是宿主依赖常量）。

## Acceptance Criteria

- [ ] AC1（能取假，不再假红）：16-lane 负载下 ol-scd-g teardown 后不触发 leak-scan 假红（⛔ 仍 4 轮同形假红 ⇒ 假）。
- [ ] AC2（能取假，真泄漏仍红）：真实 tmux 泄漏仍被 scan 判红（⛔ 放宽窗口后真泄漏漏报 ⇒ 假）。

## Definition of Done

reap-wait 窗口/teardown 修正落地 develop；AC1-2 全勾；16-lane 下 ol-scd-g 不再假红（AC1）、真泄漏仍红（AC2）。

## Touches

- plugin/scripts/tmux-leak-scan.sh（reap-wait 窗口读宿主，或 teardown 提速）
- plugin/test/session-liveness.test.mjs（或对应测试）
- tasks/gap-suite-leak-scan-ol-scd-g-teardown-slow.md（自身）