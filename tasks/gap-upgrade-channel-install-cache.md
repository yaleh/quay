---
id: gap-upgrade-channel-install-cache
title: upgrade 通道 3 测试的参数化 install 缓存——consumer-config/旧源码内容寻址，245s → ~100s
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

install-config-driven-e2e-upgrade.test.mjs（245s/轮，product 组，main 相）被 `gap-suite-extend-shared-install-cache` 的 Plan 第 4 步明确「后议」——它的 3 个测试（A3 旧→新升级、AC6/AC1 organic consumer config 保留、AC2 backup+rollback）**不能直接复用现有共享 fixture**：fixture 是固定 config 的单形安装（STANDARD_INIT_ARGS），而这 3 题需要 (a) 对**改了源码**的旧插件安装（A3：真插件+legacy 标记，源码内容可寻址）、(b) 对**自定义 consumer config** 的安装（AC6/AC1、AC2：升级前写入 evolved config，升级必须保留整个 loop 段）。现有 `_fixtureHash` 不含 target 形状也不含 consumer config ⇒ 无法命中。机制级扩展：让 fixture 键包含 pre-install workspace config（consumer-config 参数化）+ 支持旧源码哈希，使 A3/AC6/AC1/AC2 的 baseline/旧安装段跨轮复用。目标：245s → ~100s（免 2-3 次真 install/轮）。

## Plan

1. 扩展 fixture 键：`_fixtureHash` 纳入 pre-install workspace 的 config（consumer-config 形状）与旧插件源码（A3 的 legacy 标记 = 固定内容哈希），使参数化安装可寻址复用。
2. A3：缓存 OLD install 半段（旧插件源码哈希为键）；NEW 升级半段保留真 install（升级路径本身是断言对象）。
3. AC6/AC1、AC2：consumer-config 参数化 fixture 命中 baseline；升级/失败-升级半段保留真 install。
4. 负控制不回归：config-preserving 断言（整个 loop 段逐字保留）、backup/rollback 断言必须仍是真行为。
5. 前后对照：同 selected set 前后各一次，upgrade 文件墙钟下降、AC 全绿、0-cancelled。

## Acceptance Criteria

- [ ] AC1（能取假，读生产载体）：A3 / AC6 / AC1 / AC2 完成时，参数化 fixture 缓存命中（`/var/tmp/quay-install-fixture-*` 对应键存在 `.fixture-ready`），真 install 计数下降。
- [ ] AC2（能取假，负控制）：config-preserving 升级后整个 loop 段逐字不变（AC6/AC1 断言不回归）；backup/rollback 仍是真行为（AC2 断言不回归）。
- [ ] AC3（能取假，机制）：fixture 键含 consumer-config / 旧源码哈希；与 `gap-suite-extend-shared-install-cache` 的 fixture 机件共用（plugin/test/helpers/）。
- [ ] AC4（测量）：同 selected set 前后对照，upgrade 文件墙钟 245s → ~100s，0-cancelled。

## Definition of Done

A3 / AC6 / AC1 / AC2 的 baseline/旧安装半段通过参数化 fixture 复用（consumer-config 与旧源码内容寻址）；config-preserving 与 backup/rollback 语义不回归；前后对照实测 245s → ~100s 且 0-cancelled。

## Touches

- plugin/test/quay-init-loop-helpers.mjs（或 plugin/test/helpers/quay-init-install-fixture.mjs——fixture 键参数化）
- packages/quay/test/install-config-driven-e2e-upgrade.test.mjs（A3 / AC6 / AC1 / AC2 接参数化 fixture）
- tasks/gap-upgrade-channel-install-cache.md（自身）