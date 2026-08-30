---
id: gap-suite-extend-shared-install-cache
title: 共享 install 缓存扩展到 quay-init-loop serial 家族 + install-config-driven-e2e
  可复用测试（数据：serial 窗 356s 里 core 12 / drift-report 11 次真 install）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

实测（verification-round.jsonl 最近 8 轮聚合 + 单 install 计时）：一次 `quay-init --loop` install ≈ 16–19s（lane 负载下，sys 16.7s = fs 争用）。每轮 965s 的墙钟 = static 90s + **serial/lowconc 重叠窗 356s** + main 516s（顺序相）。serial 窗被 quay-init-loop 家族主导，而它们仍每测试真 install：**quay-init-loop-core 12 次 runInit、quay-init-drift-report 11 次、quay-init.test 4 次、quay-init-loop-consumer-doc-refs 3 次**。plugin/test/quay-init-loop-helpers.mjs 已有跨 run 持久、内容寻址、文件锁的共享 install fixture（sharedFixture / laydownWorkspace，`/var/tmp/quay-install-fixture-*`），quay-init-loop-runtime 已用它把 14 题压到 1 次 install。把缓存扩到这些 serial 文件 + install-config-driven-e2e 家族可复用测试，直接把 serial 窗 356s 和 main 相的 install 文件往下压，load 中性。

## Plan

1. 把 sharedFixture / laydownTemplate / laydownWorkspace / makeTmp / cleanup / diskWorktreeRoot / runInit 抽到 plugin/test/helpers/quay-init-install-fixture.mjs（先例：plugin/test/helpers/tmp-workspace.mjs 已被 packages/quay/test 跨包 import，无方向闸门）；quay-init-loop-helpers.mjs 变薄再导出，quay-init-loop-runtime 不回归。
2. serial 家族：quay-init-loop-core（12 runInit）、drift-report（11）、quay-init（4）、consumer-doc-refs（3）——按测试分类，可复用的换 laydownWorkspace 副本 + 目标文件写入；必须真 install 的保留（字节恒等 / 反穿越 / 升级 / 改插件源码类）。
3. main 家族：runtime A5-node / A5-go / AC9 / A6 + e2e-A2 接 fixture 副本（2 次 install → 1 次）。
4. 明确不动：runtime AC6 anti-pass-through（负控制语义）、e2e A1（两种 test_command 字节恒等）、upgrade 升级/参数化路径（后议）。
5. 前后对照：同一 selected set 跑 full suite 前后各一次，对比真 install 计数与 serial_phase_ms / main_phase_ms（AC2 纪律，0-cancelled）。

## Acceptance Criteria

- [ ] AC1（能取假，读生产载体）：serial 家族 + runtime A5-node/A5-go/AC9/A6 + e2e-A2 完成时，fixture 缓存命中（`/var/tmp/quay-install-fixture-*/` 存在 `.fixture-ready`，真 install 计数下降）。
- [ ] AC2（能取假，负控制）：AC6 anti-pass-through 与 e2e A1 仍执行真 install（config 必须真不同，断言不回归）；升级 / 字节恒等类测试不回归。
- [ ] AC3（能取假，机制）：helper 从 plugin/test/helpers/ 被 plugin/test 与 packages/quay/test 双方 import；quay-init-loop-runtime 全部测试不回归。
- [ ] AC4（测量，AC2 纪律）：同 selected set 前后对照——本家族真 install 次数下降（目标 ≥10），serial_phase_ms / main_phase_ms 下降，0-cancelled。

## Definition of Done

serial quay-init-loop 家族（core / drift-report / quay-init / consumer-doc-refs）与 runtime A5/A6 + e2e-A2 通过共享 fixture 副本运行，真 install 计数大幅下降；fixture helper 位于 plugin/test/helpers/ 且跨包可用；前后对照实测 serial/main 相墙钟下降且 0-cancelled；负控制类测试保持真 install 语义不变。

## Touches

- plugin/test/helpers/quay-init-install-fixture.mjs（新——fixture 机件抽出）
- plugin/test/quay-init-loop-helpers.mjs（变薄再导出，行为不变）
- plugin/test/quay-init-loop-runtime.test.mjs（import 路径更新，无行为变化）
- plugin/test/quay-init-loop-core.test.mjs（可复用测试接 laydownWorkspace）
- plugin/test/quay-init-drift-report.test.mjs（同上）
- plugin/test/quay-init.test.mjs（同上）
- plugin/test/quay-init-loop-consumer-doc-refs.test.mjs（同上）
- packages/quay/test/install-config-driven-e2e-runtime.test.mjs（A5-node / A5-go / AC9 / A6 接 laydownWorkspace）
- packages/quay/test/install-config-driven-e2e.test.mjs（A2 接 fixture 副本 + 1 次重装）
- tasks/gap-suite-extend-shared-install-cache.md（自身）