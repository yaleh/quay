---
id: gap-observation-ac1-perf-threshold-relax
title: observation.test.mjs AC1 性能阈值在并发 suite 负载下不稳定——放宽到「仍区分 8.8s 全遍历 vs 亚秒增量」量级
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`packages/quay/test/observation.test.mjs` AC1 断言「/tasks 冷请求 <1.5s、预热后 <200ms（≥1500 任务/≥10000 提交 fixture）」在并发 fan-in + 机器负载波动（loadavg 1.97↔23.79）下不稳定——git 命令慢、请求反复超阈值，误杀无关任务（dashboard-taskcard 纯渲染改动 3 次触顶）。这是 performance 测试阈值与并发 suite 负载的系统性冲突，非任务自身回归。

**人 2026-09-01 裁定：放宽 AC1 的 /tasks 性能阈值。⛔ 关键约束**：放宽不是「放弃验证性能优化」——tasks-page 核心目标是「从 8.8s 同步阻塞降到合理值」，阈值放宽后仍要能区分「全历史遍历（~8.8s）」与「增量+预热（亚秒级）」两个量级，**别放宽到连「没做优化」也能过**（硬规则 4）。阈值应落在 8.8s 与优化后实际耗时之间。

## Plan

1. **实测优化后实际耗时**（增量+预热路径的冷/热请求），作为阈值下限依据。
2. **改 AC1 阈值断言**：冷请求 <1.5s → <3s（甚至 <5s，但必须 <8.8s 全遍历量级）；预热 <200ms → <500ms。或给 performance 测试加「负载豁免」（loadavg/cpu_stall 超限时跳过 perf 断言、只验正确性），二选一或组合。
3. **验证**：改完跑 observation.test.mjs，确认真实负载下稳定绿；且「全历史遍历实现」仍会 fail 阈值（负控制，硬规则 4）。

## Acceptance Criteria

- [ ] AC1（能取假，阈值仍能区分量级）：放宽后的冷请求阈值 <8.8s（全历史遍历量级）且 > 优化后实测冷耗时——即「没做优化（全遍历）」仍会 fail，阈值不是恒真；（⛔ 放宽到 ≥8.8s 或容纳任意负载 ⇒ 假）。
- [ ] AC2（能取假，预热量级）：预热后阈值亚秒级（<500ms），仍与冷请求分属两个量级；（⛔ 预热阈值升到秒级 ⇒ 假）。
- [ ] AC3（能取假，负载稳定）：并发 fan-in + 真实负载下 observation.test.mjs 稳定绿（不再因负载波动误杀）；（⛔ 仍反复红 ⇒ 假）。

## Definition of Done

AC1 阈值放宽到「仍区分 8.8s 全遍历 vs 亚秒增量」量级；AC1-AC3 勾；全历史遍历实现仍会 fail（负控制）；真实负载下 observation.test.mjs 稳定绿。

## Touches

- packages/quay/test/observation.test.mjs（AC1 冷/预热阈值断言放宽 + 可选负载豁免）
- tasks/gap-observation-ac1-perf-threshold-relax.md（自身）
