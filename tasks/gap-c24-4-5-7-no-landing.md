---
id: gap-c24-4-5-7-no-landing
title: AC76 判据5 的 C24-4/5/7 无落点——在飞维度退役的三条找不到任何载体（manager 11:1xZ 报）
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

**（AC76 判据5 的 C24 在飞派生退役——C24-4/5/7 无落点；manager 11:1xZ 逐条查实）**。

**背景**：AC76（在飞唯一读法 = inner 任务 subagent，人 09:1xZ 裁定）判据5 把 C24 清单的在飞派生退役为显式标注（AC48 判据2 做法）。manager 10:5xZ 逐条查：
```
C24-1/2/3  有 `RETIRED (AC76 C24-N…)` 标注 + 进 cap-counts-subagents-check.ts 的检查表   ✓ 有落点
C24-4      /live 与 observation 面的 realInFlight 消费端         → 查不到任何落点
C24-5      A16 --task-start 括号的【在飞】用途（派发留痕用途另议）→ 查不到任何落点
C24-7      cap 维度与在飞维度合并                                → 查不到任何落点
```

**判据1**：C24-4/5/7 三条的退役【落点】补齐——或按 AC48 判据2 形态标注（如 C24-1/2/3 那样进 cap-counts-subagents-check 的检查表），或显式写明「该条不适用/已并入」，**不允许「退役了但无落点」**（退役而不可查 = 记录上像退役、行为上没退役，AC66 族）。
**判据2（能取假）**：现状 = C24-1/2/3 有落点而 C24-4/5/7 无 ⇒ 真样本回放红（缺落点）；补后绿。
**判据3**：`cap-counts-subagents-check` 的 C24 检查表覆盖 C24-1/2/3，补 4/5/7 的对应行。

**不覆盖**：不改 C24 清单内容（在飞派生退役本身已定）；不改 cap-counts-subagents-check 的核心判据。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 AC76 判据5 的 C24 清单 + cap-counts-subagents-check.ts 的检查表（C24-1/2/3 落点形态）。
2. 判据1：C24-4/5/7 落点补齐（标注进检查表，或显式「不适用/并入」）。
3. 判据2 能取假：现状（缺落点）回放红 + 补后绿。
4. 判据3：cap-counts-subagents-check 覆盖 4/5/7。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：C24-4/5/7 退役落点补齐（标注或显式不适用），无「退役而无落点」。
- [ ] AC2 判据2 能取假：现状缺落点回放红；补后绿。
- [ ] AC3 判据3：cap-counts-subagents-check 检查表覆盖 C24-4/5/7。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] C24-4/5/7 退役落点补齐 + cap-counts-subagents-check 覆盖 + 能取假。

## Touches

- plugin/scripts/cap-counts-subagents-check.ts（C24-4/5/7 落点/检查表补行）
- plugin/test/cap-counts-subagents-check.test.mjs（补测）
- tasks/gap-c24-4-5-7-no-landing.md（自身）

## Evidence

（落地后回填）
