---
id: gap-ac58-retired-clauses-delete-and-archive
title: AC58 通则①·退役即迁出——退役条款从高频文件删除、另存 archive（落点映射强制）
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

**人裁定（2026-08-14 01:0xZ，推翻原「加退役标注但保留正文」建议）**：「退役规则应从高频读取/使用的文件**删除**，另创建 **archive 文件保存**。」
采纳且理由更强：`CLAUDE.md` 开篇逐字「它的行数是本仓库最稀缺的资源」——**退役标注恰恰堆积在每会话必读的文件里，挤掉的是活指令**。
实测：outer tick-core 2 处 / inner loop 12 处 / CLAUDE.md 4 处退役标注。

**AC58 判据（phase-goal 逐字）**：
- 判据1（位置）：三层执行核 + `CLAUDE.md` + 两份 loop 文档里，**标注为退役/前提已死的条款正文 = 0 条**（只允许留**一行指针**指向 archive）。
- 判据2（硬规则⑤ 强制，不可省）：**每次迁出必须产出【落点映射】**——被删内容的**每一个独有词条 → archive 中的位置**，映射贴进删除提交；**验的是「全部有家」不是「抽查几个有家」**（2026-08-10 实证：抽查 7 个就删了 164 行，3 条无家可归）。
- 判据3（能取假；负控制由落地方产出，manager 不构造）：**一条「删了但没进 archive」的样本 ⇒ 检查必须红。**
- ⚠️ 不覆盖：不规定 archive 路径格式；**不删除仍在生效的条款**——迁出标准是「已标退役/前提已死」，不是「最近没用」。

**注**：outer 的 `B4【RETIRED】` 样板从「正确处理」降为「过渡形态」——它当时对，现在按新裁定要迁出（含 AC48 对 integration-branch-model.ts / integration-batch-merge.sh / SPEC-branching-model 的退役标注）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 枚举三层执行核 + CLAUDE.md + 两份 loop 文档里的退役/前提已死条款（含 AC48 的 integration 三件退役标注）。
2. 创建 archive 文件。
3. 删除高频文件里的退役条款正文，只留一行指针 → archive。
4. **每次迁出产出落点映射**（每个独有词条 → archive 位置），贴进删除提交。
5. 检查器：高频文件里退役条款正文 = 0（只留指针）+ 负控制（「删了但没进 archive」样本 ⇒ 红）。

## Acceptance Criteria

- [ ] AC1 三层执行核 + CLAUDE.md + 两份 loop 文档退役条款正文 = 0（只留一行指针）。
- [ ] AC2 每次迁出带落点映射（每个独有词条 → archive 位置，贴进删除提交——硬规则⑤）。
- [ ] AC3 负控制：一条「删了但没进 archive」的样本 ⇒ 红。
- [ ] AC4 不删仍在生效条款（迁出标准=已标退役/前提已死）；archive 路径格式实现面自定。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 退役条款迁出完成（高频文件 0 正文、archive 全有家、落点映射贴删除提交）。
- [ ] 负控制红 + 检查器接线。

## Touches

- orchestration/orchestrator-tick-core.md / orchestration/orchestrator-loop-tick.md（退役条款删除 + 指针）
- plugin/loop/fast-mode-loop-tick.md（inner loop 12 处退役标注迁出）
- CLAUDE.md（4 处退役提及迁出）
- plugin/scripts/integration-branch-model.ts / integration-batch-merge.sh / orchestration/SPEC-branching-model-…（AC48 退役标注迁出到 archive）
- （archive 文件 + 检查器 + 负控制 fixture）
- tasks/gap-ac58-retired-clauses-delete-and-archive.md（自身）

## Evidence

（落地后回填）
