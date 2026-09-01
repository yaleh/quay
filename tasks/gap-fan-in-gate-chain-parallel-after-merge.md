---
id: gap-fan-in-gate-chain-parallel-after-merge
title: fan-in 非测试 gate 链并行化——merge 先行后 {typecheck ∥ doc-check} 并行 + 合并进程（doc-check 提前到 scoped 前）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-fan-in-remove-archguard-gate
---
**type:** execution

## Proposal

机械 fan-in gate 链（`worker-driver.ts:2331-2378`）当前串行：merge→anti-drift→typecheck→archguard→scoped→doc→suite。非测试单步均值（生产 step-trace 实测）：archguard 26.9s / doc-check 11.6s / merge-develop 7.8s / typecheck 1.4s / ff 2.1s（周合计约 1.33h+0.53h+0.45h）。

merge 必须先行（改变 delta）；merge+anti-drift 之后 typecheck 与 doc-check 相互独立，可并行；doc-check 当前排在 scoped 之后（`:2378` 在 `:2375` 后），应在 scoped 前（廉价失败先于昂贵）。并行 + 合并一次进程内调用，非测试 gate 从 ~41s 降到 ~12s（配合 P-B 去 archguard）。

## Plan

1. 保持 merge-develop 为 gate 链第一步。
2. merge+anti-drift 后，typecheck 与 doc-check 并行（同进程内 Promise.all），合并为一次 gate 判定。
3. doc-check 顺序提前到 scoped-gate 之前（廉价失败先于昂贵）。
4. 验证：step-trace 顺序正确；typecheck/doc-check 判定与串行一致（N 次对照）。

## Acceptance Criteria

- [ ] AC1 merge-develop 仍是 gate 链第一步（step-trace 首 step）
- [ ] AC2 typecheck 与 doc-check 时间重叠，非测试 gate 墙钟 < 30s（基线 41s）
- [ ] AC3 并行后 typecheck/doc-check 判定与串行一致（各 N 次对照）
- [ ] AC4 doc-check 在 scoped-gate 之前（step-trace 顺序）

## Definition of Done

并行 gate 链落地 develop；AC1-4 勾；生产 step-trace 非测试 gate < 30s。

## Touches

- plugin/scripts/worker-driver.ts（runMechanicalFanIn 编排）
- tasks/gap-fan-in-gate-chain-parallel-after-merge.md（自身）
