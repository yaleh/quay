---
id: gap-fan-in-remove-archguard-gate
title: fan-in 过程取消 archguard-structure 闸——零发火、零指引、27s/次移出关键路径（降级为按需/里程碑 review）
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

archguard-runner 只输出布尔闸（sccCount==0），不枚举环/不给文件/不给修法；近 244 条 metrics 记录非零 sccCount = 0 条（从未红过），git 历史无一条按它执行的修复。占每任务 27s 串行关键路径（周 1.33h），零指引价值。从 fan-in gate 链移除；`archguard-runner.ts` 与 metrics 镜像写保留（按需入口不动）。

## Plan

1. `runMechanicalFanIn` 编排删除 archguard-structure 步（fan-in gate 链不再含该 step）。
2. `archguard-runner.ts` 保留可独立调用（metrics 按需产出）。
3. 结构检查降级落点：milestone-review 检查面或文档化按需命令（AC4）。
4. 验证：生产 step-trace 无 archguard step；非测试 gate 链墙钟下降。

## Acceptance Criteria

- [ ] AC1 机械 fan-in 步骤不再含 archguard-structure（生产 step-trace 无该 step）
- [ ] AC2 移除后非测试 gate 链墙钟下降
- [ ] AC3 archguard-runner 仍可直接调用并产出 metrics（按需保留）
- [ ] AC4 结构检查有新的落点（milestone-review 检查面或文档化按需命令）

## Definition of Done

fan-in 无 archguard step 且 archguard-runner 保留；AC1-4 勾。

## Touches

- plugin/scripts/worker-driver.ts（删 archguard-structure 步）
- tasks/gap-fan-in-remove-archguard-gate.md（自身）
