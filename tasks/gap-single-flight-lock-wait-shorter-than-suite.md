---
id: gap-single-flight-lock-wait-shorter-than-suite
title: "single-flight 锁等待 600s < suite 时长 ~840s——第 3+ suite 在 slot 释放前 fail-closed 白等 600s 后 relaunch"
status: ready
labels:
  - gap
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

single-flight 锁 wait 600s（slot-defect 修的 wall-clock 计时）**短于 suite 实测时长 ~840s（807931ms）**。5 fan-in 撞 2 slot 时，第 3+ suite 在 slot 释放前就 fail-closed（exit=1「not starting」）白等 600s，每次碰撞浪费 600s 后 relaunch。实测 full-suite-state-stale 17:53 + dod-check-timing 17:55 两次「锁拒启」，非测试失败。self-resolving（relaunch 后等 slot 释放即跑）但每波碰撞白等 600s。

## Acceptance Criteria

- [ ] AC1: lock wait ≥ suite 时长（读 suite 实测上界，或改 fan-in workflow 在 launch suite 前先取 slot，不 launch 后撞 600s 超时）。
- [ ] AC2: 负控制——S=2 下 5 fan-in 并发，第 3+ suite 不因锁等待 < suite 时长而 fail-closed（要么先取 slot 再 launch，要么 wait 足够长）。
- [ ] AC3: 不再出现「锁拒启 exit=1」的 relaunch（真实输出）。

## Definition of Done

- [ ] 5 fan-in 撞 2 slot 时，第 3+ suite 不白等 600s fail-closed（先取 slot 或 wait 足够长），无「锁拒启」relaunch（真实输出，非 fixture）。

## Touches

- tasks/gap-single-flight-lock-wait-shorter-than-suite.md（自身）
- plugin/scripts/fan-in-execute.js（launch suite 前取 slot 或 lock wait 上调）
- plugin/scripts/fan-in-ff-merge.sh（lock wait 语义）
- plugin/test/fan-in-execute-paths.test.mjs（锁等待负控制）
