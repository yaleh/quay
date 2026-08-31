---
id: gap-suite-install-family-reduce-runinit
title: 减少「真 quay-init 运行」——install 家族 runInit 20→~4-6（断言迁移到 laydownWorkspace）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

install 家族 3 文件共 20 次 runInit（真 quay-init 运行：runtime 9 / loop 7 / driver 4），每次 spawn quay-init.sh→python3 children，是 per-test 主成本。共享 fixture 已摊销安装，laydownWorkspace（拷贝）是快的。方案 = 把「断言 laid-down 状态」的测试从 runInit 迁到 laydownWorkspace；仅验证「运行行为本身」（exit code / spawn 副作用 / 时序）保留真运行。目标 runInit 20→~4-6，预期省 ~150s（家族墙降 ~30%）。

**风险**：合并断言面若共享状态不覆盖某断言→假绿。缓解：fixture 保证 byte 一致；迁移后逐测试核对断言面。

## Plan

1. 迁移「断言 laid-down 状态」测试 runInit→laydownWorkspace；仅「运行行为」保留真运行。

## Acceptance Criteria

- [ ] AC1（能取假）：家族 runInit 计数 20→≤6（grep 机械可查）；（⛔ 仍 >6 ⇒ 假）。
- [ ] AC2（能取假，负控制）：迁移测试断言全过 + 每个迁移测试的断言面确实由共享状态承载（不丢验证面）；（⛔ 丢断言面 ⇒ 假）。
- [ ] AC3（能取假）：全量 suite 绿。

## Definition of Done

家族 runInit≤6；真实一轮全量 suite 绿；改前后对照墙读。

## Touches

- plugin/test/quay-init-loop-runtime.test.mjs（迁移）
- plugin/test/quay-init-loop.test.mjs（迁移）
- plugin/test/quay-init-loop-driver.test.mjs（迁移）
- plugin/test/helpers/quay-init-install-fixture.mjs（如需扩共享面）
- tasks/gap-suite-install-family-reduce-runinit.md（自身）
