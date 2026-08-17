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

**⊢ 与 AC101 同源（⛔ 假说已证否，2026-08-16 23:5xZ manager 裁定）**：曾以为「AC101（suite ≤600s）若达成，本缺陷紧迫度大幅下降」——**AC101 已达成（round224=500.8s），而 concurrency 的 fan-in 仍然卡在 turn-enforcement**（靠 inner 杀孤儿 suite + 手动补 ff/bracket 才完成）⇒ **「同一堵墙」假说被证否。** ⇒ **优先级不再压在最低位**（具体位次看与 delta-scope/UI 链的相对紧迫度，⛔ 不在此定）。

**inner 当下恢复**（已执行，不等本任务）：本会话直接跑合并态 suite（能等 10min）→ 绿后补机械步骤（capture env → per-task-suite-record → flip → fan-in-ff-merge.sh --agent-id 原 subagent id → bracket close）。

**复发证据（2026-08-17 03:5x-04:0xZ，outer 观测）**：**AC95 重派 fan-in（whg27obzj）第 2 次撞同一堵墙**——develop 已稳定（03:25 后 37min 未动，re-merge 循环可收口），但 fan-in 仍连续跑了 **3 次全量 suite 尝试**（`fan-in-suite-gap-ac95-webui-15-views-v{1,2,3}.time`，每轮 11-15min，pid 1252818→1771195→2295375），均未落 per-task-suite-records（fullSuiteRan=true 记录缺）。⇒ 与 concurrency 那次同形（suite >回合预算 ⇒ turn-enforcement 强制收尾 ⇒ 重跑），**AC101 达成不缓解此缺陷**（round224=500.8s 单轮，但 fan-in 的 suite 因 CPU 争用 11-15min 仍超预算）。**发生率：第 2 个 code 型 fan-in 复发**（concurrency → AC95）。

**⚠️ 复核更正（2026-08-17 05:45Z）**：上一段「outer-tick-log 第 3 例同形」**已证否**——outer-tick-log 的未 land suite 实为**内容红**（`verify-deliver-coldstart.test.mjs` basename `--` guard 缺陷，05:23Z suite RED），已立案 `gap-verify-deliver-coldstart-basename-dash-guard` 并派发。**⛔ 不是 turn-budget 复发**；turn-budget 发生率保持 **2**（concurrency → AC95），外层当时按「未 land + 重跑」记了同形，但未等 inner 报告就猜了根因（硬规则 4 推论四：能解释 ≠ 被检验）——外层自查记账。

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
