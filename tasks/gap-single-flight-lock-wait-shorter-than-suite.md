---
id: gap-single-flight-lock-wait-shorter-than-suite
title: "single-flight 锁等待 600s < suite 时长 ~840s——第 3+ suite 在 slot 释放前 fail-closed 白等 600s 后 relaunch"
status: done
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

- [x] AC1: lock wait ≥ suite 时长（读 suite 实测上界，或改 fan-in workflow 在 launch suite 前先取 slot，不 launch 后撞 600s 超时）。
      —— SUITE_LAUNCH/ISOLATE_LAUNCH 启动 detached suite 时经 env 把 FULL_SUITE_LOCK_TIMEOUT 提到
      `suiteLockTimeoutSecs=900`（≥ suite 实测上界 807931ms ≈ 808s；args 可覆盖、调用方可经 env 覆盖），
      第 3+ suite 等够 slot 释放而非 600s fail-closed。
- [x] AC2: 负控制——S=2 下 5 fan-in 并发，第 3+ suite 不因锁等待 < suite 时长而 fail-closed（要么先取 slot 再 launch，要么 wait 足够长）。
      —— plugin/test/fan-in-execute-paths.test.mjs「⑧⑩ 锁等待负控制」：结构负控制（launch 块携带
      FULL_SUITE_LOCK_TIMEOUT ≥ 840，revert 即红）+ REAL wait-and-acquire（S=2 槽全忙 → 释放 → 获取
      exit=0 非 fail-closed）+ 正对照（等待短于释放 ⇒ 确实「not starting」fail-closed，机制可取假）。
- [x] AC3: 不再出现「锁拒启 exit=1」的 relaunch（真实输出）。
      —— REAL 测试真实 bash/flock：锁等待足够长时 suite 获取释放槽 exit=0、日志无「not starting」；
      wait 900s ≥ suite 时长 ⇒ 第 3+ suite 最坏等一个 suite 跑完（≤ ~840s）即可获取，不再 fail-closed relaunch。

## Definition of Done

- [x] 5 fan-in 撞 2 slot 时，第 3+ suite 不白等 600s fail-closed（先取 slot 或 wait 足够长），无「锁拒启」relaunch（真实输出，非 fixture）。
      —— fan-in 启动的 suite 携带 FULL_SUITE_LOCK_TIMEOUT=900 ≥ suite 时长，第 3+ suite 等待而非
      fail-closed；REAL 测试证明「槽忙 → 释放 → 获取 exit=0」且无「not starting」。

## Touches

- tasks/gap-single-flight-lock-wait-shorter-than-suite.md（自身）
- plugin/workflows/fan-in-execute.js（lock wait 上调——SUITE_LAUNCH/ISOLATE_LAUNCH 经 env 把 FULL_SUITE_LOCK_TIMEOUT 提到 ≥ suite 时长，默认 suiteLockTimeoutSecs=900；ff 调用显式传 --lock-wait mergeLockWaitSecs）
- .claude/workflows/fan-in-execute.js（双拷贝同步，byte-identical）
- plugin/scripts/fan-in-ff-merge.sh（lock wait 语义——正确性 merge 锁与 suite 资源锁区分；fan-in 流程显式传 --lock-wait）
- plugin/test/fan-in-execute-paths.test.mjs（锁等待负控制——结构 + REAL wait-and-acquire + 正对照）
