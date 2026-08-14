---
id: gap-ac59-family5-scan-covers-execution-cores
title: AC59 通则②·FAMILY-5 扫描面覆盖三层执行核（真样本回放可取假）
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**AC59（通则②·FAMILY-5 扫描面覆盖三层执行核）判据（phase-goal 逐字）**：
- 判据1：`instrument-failure-check` 的 gate 扫描面**包含三层执行核**（当前只扫 tick 文档 + `plugin/scripts/`）。
- 判据2（能取假，且用【真样本回放】不构造新数据——合 D2）：今天已实测的三个 FAMILY-5 实例必须被它检出——
  manager 的 `B3 戊`（读 `full-suite-state.json` 断言实时、零新鲜度）／outer 核 `:34 A11` 与 `:52 B3`（同形）／
  inner 核 `:28 A9`（同形）。**一个检不出已知真实例的扫描面，不算覆盖。**
- 理由：**这三处是同一个 bug 的三个副本，而 FAMILY-5 早已被编号却没扫这三个位置** ⇒ **修根不修消费者。**

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 扩展 `instrument-failure-check` 的 gate 扫描面，包含三层执行核（orchestrator/fast-mode/manager tick-core）。
2. **真样本回放（负控制）**：五个已知真实例（manager B3-戊 / outer :34 A11 + :52 B3 / inner :28 A9）必须被检出——检不出任一 ⇒ 不算覆盖。
3. 接线 + 验证。

## Acceptance Criteria

- [ ] AC1 `instrument-failure-check` gate 扫描面包含三层执行核。
- [ ] AC2 真样本回放：五个已知真实例全被检出（manager B3-戊 / outer A11+B3 / inner A9）。
- [ ] AC3 负控制由落地方产出（D2 归属）；检不出已知真实例 ⇒ 不算覆盖。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 扫描面覆盖三层执行核（orchestrator-tick-core / fast-mode-tick-core / manager-tick-core）+ `plugin/scripts/`。
- [ ] 真样本回放：五个已知 FAMILY-5 实例（manager B3-戊 / outer :34 A11 + :52 B3 / inner :28 A9）全部被检出——检不出任一不算覆盖。
- [ ] 检查器接线进 gate（instrument-failure-check）+ 既有测试全绿、`--for-task` scoped 门绿。

## Touches

- plugin/scripts/instrument-failure-check.ts（扫描面扩展）
- orchestration/orchestrator-tick-core.md / orchestration/fast-mode-tick-core.md / orchestration/manager-tick-core.md（被测对象）
- （负控制 fixture）
- tasks/gap-ac59-family5-scan-covers-execution-cores.md（自身）

## Evidence

（落地后回填）
