---
id: gap-ac61-staleness-list-item-disposition
title: AC61 清单逐条处置——A-1…A-7/B-1…B-4 迁出或核实有效 + integration 命中逐条分类
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac58-retired-clauses-delete-and-archive
---

**type:** execution

## Proposal

**AC61（清单逐条处置——通则做完之后）判据（phase-goal 逐字）**：
- 判据1：manager 2026-08-14 交出的清单 **A-1…A-7 / B-1…B-4** 逐条处置：
  **要么已按 AC58 迁出（带落点映射），要么明写「经核实仍有效」并给出核实读数**。
- 判据2（补 manager 没做完的那半，明写而不装作已覆盖）：**inner loop 文档 39 处 / outer loop 文档 12 处 `integration` 命中，
  manager 只给了计数、没有逐条打印分类** ⇒ **必须逐条打印并分类（活指令 / 退役注记 / 历史记述）**，
  **不得只给计数**（硬规则② 与 A0b⑤(c)）。
- **已知最严重的一条（inner 核 `:65 C7`）**：`integration-branch-model.ts --overlaps-unverified` **不得传空串**
  —— **该模块已于 AC48 标 RETIRED、零生产调用者** ⇒ **活指令指向退役模块**，且它就在 inner 现在要读的那份文件里。
- ⚠️ 不阻塞 AC54–57（四条都不碰那条路径）——排在通则之后，不插队。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 逐条处置 A-1…A-7 / B-1…B-4：迁出（AC58 + 落点映射）或「经核实仍有效」+ 核实读数。
2. **逐条打印并分类** inner loop 39 处 + outer loop 12 处 `integration` 命中（活指令 / 退役注记 / 历史记述）——不得只给计数。
3. 修 inner 核 `:65 C7`：活指令指向退役的 integration-branch-model.ts —— 迁出或改指有效模块。
4. 检查器：清单逐条有处置记录（迁出带映射 或 核实读数）；integration 命中逐条分类。

## Acceptance Criteria

- [ ] AC1 A-1…A-7 / B-1…B-4 逐条处置（迁出带落点映射 或 核实有效+读数）。
- [ ] AC2 inner loop 39 处 + outer loop 12 处 `integration` 命中**逐条打印并分类**（活指令/退役注记/历史记述），不得只给计数。
- [ ] AC3 inner 核 :65 C7 修（活指令指向退役模块）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 清单逐条有处置记录 + integration 命中逐条分类 + :65 C7 修。
- [ ] 负控制（某条无处置记录 ⇒ 红）。

## Touches

- plugin/loop/fast-mode-loop-tick.md（inner loop integration 命中逐条分类 + :65 C7）
- orchestration/orchestrator-loop-tick.md（outer loop integration 命中逐条分类）
- （检查器 + 负控制 fixture）
- tasks/gap-ac61-staleness-list-item-disposition.md（自身）

## Evidence

（落地后回填）
