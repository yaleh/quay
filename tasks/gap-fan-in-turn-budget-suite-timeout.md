---
id: gap-fan-in-turn-budget-suite-timeout
title: "fan-in-execute subagent 回合预算等不完 ~10min 全量 suite——step4 起后台后回合耗尽被强制收尾，机械步骤全缺（release-timeout 实证）"
status: ready
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

**来源**：inner 2026-08-16 21:4xZ（实证 + 恢复方案）+ manager 裁定（立案，优先级最低——响亮失败不会污染记录）。

**问题**：`fan-in-execute.js` 的 subagent 按四步走（merge develop → delta 判定 → typecheck → scoped 门 + 全量 suite），step4 把全量 suite 启动为**后台任务**后，subagent 等 suite 时**回合预算耗尽被强制收尾**——suite 未完成、capture env 未写、flip/ff/bracket 全未执行。

**实证（release-timeout）**：step1-3 全过（merge 2027e083 无冲突 → anti-drift OK → ts-typecheck ADMITTED → scoped gate GREEN），step2 code_delta 非空 ⇒ fail-closed FULL SUITE。step4 全量 suite 起后台后 subagent 回合耗尽。对比 bypass-ruled 的 suite 242s（回合内完成）⇒ **阈值在 ~600s 全量 suite 处**。

**⛔ 「阈值 ~600s」不得作为已知量写死**（manager 裁定）：n=2 里两个样本不同类（242s 低于全量轮下界 244s，多半非全量轮；全量轮实际分布 485-747s）。根因写成**待答问题**，不是预设值。

**影响面**：剩余 code 型 fan-in（touches/concurrency-literal/delivery-laydown/AC100）全需要全量 suite ⇒ **逐个都会撞同一堵墙**。结构问题非概率问题。

**⊢ 与 AC101 同源**：全量轮 485-747s 骑在 600s 上。AC101（suite ≤600s）若达成，本缺陷紧迫度大幅下降。⇒ **本任务优先级低于 AC101**（AC101 是人明令，本条是自加条件，硬规则⑫）。

**inner 当下恢复**（已执行，不等本任务）：本会话直接跑合并态 suite（能等 10min）→ 绿后补机械步骤（capture env → per-task-suite-record → flip → fan-in-ff-merge.sh --agent-id 原 subagent id → bracket close）。

## Acceptance Criteria

- [ ] AC1: fan-in-execute 的 step4 全量 suite 能在超回合预算下完成机械步骤（subagent 把 suite 交给长生命周期载体 / workflow 自身等待 / 其他——实现方选）。取假：构造 step2 code_delta 非空 ⇒ 全量 suite 必跑且机械步骤必完成（flip/ff/bracket 全执行）。
- [ ] AC2: 修复后跑一轮 code 型 fan-in（如 touches/concurrency/AC100）验证全流程——不再出现「suite 起了但 flip/ff/bracket 缺」。
- [ ] AC3: 恢复路径若保留（inner 手动跑 suite + 补机械步骤），需落成脚本/文档可复现，不靠记忆。

## Definition of Done

- [ ] code 型 fan-in 的 step4 全量 suite 能完成机械步骤；不再有「回合耗尽、步骤全缺」。

## Touches

- plugin/workflows/fan-in-execute.js（step4 长 suite 承载）
- plugin/scripts/fan-in-ff-merge.sh（若恢复路径脚本化）
- plugin/test/fan-in-execute-paths.test.mjs（取假对照）
- tasks/gap-fan-in-turn-budget-suite-timeout.md（自身）
