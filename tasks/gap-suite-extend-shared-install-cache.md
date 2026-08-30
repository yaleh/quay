---
id: gap-suite-extend-shared-install-cache
title: 把共享 install 缓存（sharedFixture）扩展到 install-config-driven-e2e
  家族可复用测试——runtime 4 题 + e2e-A2 免真 install
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

install-config-driven-e2e-runtime / -upgrade / -e2e 三个文件每个测试都做一次真 `quay-init --loop` install（实测单次 16–19s，lane-16 套件负载下，sys 16.7s = fs 争用）。而 plugin/test/quay-init-loop-helpers.mjs 已有跨 run 持久、内容寻址、文件锁的共享 install fixture（sharedFixture / laydownWorkspace，`/var/tmp/quay-install-fixture-*`），只被 quay-init-loop-runtime 使用。把缓存模式扩到可复用测试：这些测试的 install 变成 fixture 副本（cp -a + config 路径改写），每轮省 ~5 次真 install（~80s），且 load 中性（总量下降而非上升）。不可复用者按契约保留真 install（runtime AC6 anti-pass-through 负控制语义、e2e A1 需两种 test_command 的字节恒等、upgrade 升级/参数化路径，均后议）。

## Plan

1. 把 sharedFixture / laydownTemplate / laydownWorkspace / makeTmp / cleanup / diskWorktreeRoot / runInit 抽到 plugin/test/helpers/quay-init-install-fixture.mjs（先例：plugin/test/helpers/tmp-workspace.mjs 已被 packages/quay/test 跨包 import，无方向闸门）；quay-init-loop-helpers.mjs 变薄再导出，quay-init-loop-runtime 全部测试不回归。
2. runtime A5-node / A5-go / AC9 / A6：makeWorkspace → laydownWorkspace，各自的目标文件（package.json / go.mod / main.go / dep）写进副本，原断言不变（fixture 单形是 Node 空 ws + 已安装树，字节恒等正是 A1 结论，跨 target 复用成立）。
3. e2e-A2：fixture 副本上重装一次真 install，断言零 diff（2 次 install → 1 次）。
4. 明确不动：runtime AC6 anti-pass-through（真 install + 快速失败的负控制）、e2e A1、upgrade A3 / AC6 / AC1 / AC2（参数化/升级路径）。
5. 前后对照：同一 selected set 跑 full suite 前后各一次，对比本家族真 install 次数与墙钟（AC2 纪律，0-cancelled）。

## Acceptance Criteria

- [x] AC1（能取假，读生产载体）：runtime A5-node / A5-go / AC9 / A6 与 e2e-A2 完成时，fixture 缓存命中——`/var/tmp/quay-install-fixture-*/` 存在 `.fixture-ready`，且本轮这些测试无新增真 install（可查载体：fixture 构建日志 / 真 install 计数下降）。
- [x] AC2（能取假，负控制）：AC6 anti-pass-through 与 e2e A1 仍执行真 install（其 config 必须真不同，断言不回归）。
- [x] AC3（能取假，机制）：helper 从 plugin/test/helpers/ 被 packages/quay/test 文件 import（同 tmp-workspace.mjs 先例）；quay-init-loop-runtime 全部测试不回归。
- [ ] AC4（测量，AC2 纪律）：同 selected set 前后对照——本家族真 install 次数下降 ≥5，0-cancelled。（待外部）

## Definition of Done

runtime 4 个可复用测试与 e2e-A2 通过共享 fixture 副本运行（不再每测试真 install）；fixture helper 位于 plugin/test/helpers/ 且跨包可用；前后对照实测真 install 数下降且 0-cancelled；AC6 / A1 保持真 install 语义不变。

## Touches

- plugin/test/helpers/quay-init-install-fixture.mjs（新——fixture 机件抽出）
- plugin/test/quay-init-loop-helpers.mjs（变薄再导出，行为不变）
- plugin/test/quay-init-loop-runtime.test.mjs（import 路径更新，无行为变化）
- packages/quay/test/install-config-driven-e2e-runtime.test.mjs（A5-node / A5-go / AC9 / A6 接 laydownWorkspace）
- packages/quay/test/install-config-driven-e2e.test.mjs（A2 接 fixture 副本 + 1 次重装）
- tasks/gap-suite-extend-shared-install-cache.md（自身）