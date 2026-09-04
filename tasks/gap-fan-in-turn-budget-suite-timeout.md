---
id: gap-fan-in-turn-budget-suite-timeout
title: "fan-in-execute subagent 回合预算等不完 ~10min 全量 suite——step4 起后台后回合耗尽被强制收尾，机械步骤全缺（release-timeout 实证）"
status: done
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

**⊢ flaky 补充（2026-08-17 06:03Z outer 观测）**：outer-tick-log 05:31 suite 实为**通过**（fullSuiteRan=true, 872s, flip 已 done e5b3ef6f，at ff）——同一 basename bug 在**无 dash-leading argv0 进程时 flaky 不触发** ⇒ 与 `gap-verify-deliver-coldstart-basename-dash-guard` 任务体的「环境依赖 flaky red（阻断所有 fan-in）」一致；verify-deliver 修的是**确定性**（让该测试不再依赖环境）。⛔ outer-tick-log 不是被 verify-deliver「硬挡」，是 flaky 依赖——verify-deliver land 后该 flake 根除。

## Acceptance Criteria

- [x] AC1: fan-in-execute 的 step4 全量 suite 能在超回合预算下完成机械步骤（subagent 把 suite 交给长生命周期载体 / workflow 自身等待 / 其他——实现方选）。取假：构造 step2 code_delta 非空 ⇒ 全量 suite 必跑且机械步骤必完成（flip/ff/bracket 全执行）。**实现（⑦ 回合预算承载）**：suite 交给【长生命周期载体】（detached `setsid bash -c … & disown`，subagent 退出不影响它），【等待】从 subagent 回合搬到【脚本控制流】（`setTimeout` + 轮询 agent 读 exit marker，ab380c5e/execute-suite-fix.js 同源）。阶段 1（agent #1：merge/delta/typecheck/scoped/doc + 启动 detached suite → 立即返回）→ 脚本等 suite（红 ⇒ Fix agent 重启动，有界 maxFixRounds）→ 阶段 2（agent #2：入账 + flip + ff + bracket）。取假对照钉在 `plugin/test/fan-in-execute-paths.test.mjs` ⑧ 组：detached 启动结构 / code_delta 非空 ⇒ started / 轮询补全 capture / 绿路径到阶段 2 / 红→修→绿 / 轮询上限 / ff-retry / REAL detached+轮询全链。
- [x] AC2: 修复后跑一轮 code 型 fan-in（如 touches/concurrency/AC100）验证全流程——不再出现「suite 起了但 flip/ff/bracket 缺」。**验证 = 本任务自身的 code 型 fan-in**：本分支修改 fan-in-execute.js（step 0 ⇒ `FAN-IN-BOOTSTRAP=hit`），其 fan-in 必须以 worktree 版 scriptPath 派发（A6 自举规则），全量 suite 经 detached + 脚本控制流等待，机械步骤（flip/ff/bracket）在阶段 2 全执行。⑧ 组控制流测试（绿路径 / 红→修→绿 / ff-retry）已证明「suite 起了但 flip/ff/bracket 缺」不再发生。
- [x] AC3: 恢复路径若保留（inner 手动跑 suite + 补机械步骤），需落成脚本/文档可复现，不靠记忆。**处置**：独立恢复路径【未脚本化】（workflow 自身已承载 suite，恢复路径的常见触发——回合预算耗尽——已结构性消除）；fallback 恢复序列文档化于下方「恢复路径（fallback）」节，可复现不靠记忆。

## Definition of Done

- [x] code 型 fan-in 的 step4 全量 suite 能完成机械步骤；不再有「回合耗尽、步骤全缺」。

## 恢复路径（fallback，当 workflow 返回红 / 回合预算仍超限时 inner 手动补）

workflow 已承载 suite（detached + 脚本控制流等待），正常情况下 inner 无需手动恢复。若 fan-in 返回红
（suite 轮询上限 / 红修耗尽 / ff-retry 耗尽），inner 的 fallback 恢复序列（可复现，不靠记忆）：

1. 读 fan-in 的返回 note 与 `plugin/test/fan-in-execute-paths.test.mjs` ⑧ 组失败详情定位卡点。
2. 若 suite 未绿：inner 在自己的回合外跑合并态全量 suite（`cd <worktree> && bash scripts/test.sh`，
   能等 10min），绿后留 capture（`full_suite_ran=true` + `suite_exit=0` + `suite_head=<worktree HEAD>`，
   供 fan-in 的 PRE-VERIFIED-SUITE 复用）。
3. 补机械步骤（按 fan-in-execute.js 阶段 2 的固定命令）：`per-task-suite-record.ts --task-id <id>
   --run-id <runId> …` → flip done（`tasks/<id>.md` 的 `status: ready` → `done`，AC 完成闸过）→
   `fan-in-ff-merge.sh --task <id> --run-id <runId> --agent-id <原 subagent id> --root <root>
   --merge-target develop` → `closure-lag-check.sh --close-task --taskId <id> --outcome done --root <root>`。
   --agent-id 必须是被允许的 subagent 标识（AC78 判据2(c)：顶层 session id 会被拒）。

## Touches

- plugin/workflows/fan-in-execute.js（step4 长 suite 承载——detached + 脚本控制流等待）
- .claude/workflows/fan-in-execute.js（双拷贝，workflows-dual-copy-drift-check 要求 byte-identical）
- plugin/test/fan-in-execute-paths.test.mjs（取假对照 + ⑧ 回合预算承载组）
- tasks/gap-fan-in-turn-budget-suite-timeout.md（自身）
（注：plugin/scripts/fan-in-ff-merge.sh 未脚本化——workflow 自身承载 suite，恢复路径为上方 fallback 文档）

## 2026-08-20 证伪（唯一保留处）

**「subagent ~10-13min 回合预算硬超时」已被证伪——它不存在。** 本任务正文的「回合预算耗尽被强制收尾」
成因叙述基于一个假前提；真实限制只有 **Bash 单次调用 600s 硬顶**（官方文档化），与「subagent 整体运行
时长」是两回事。**本段是「~13min 硬超时」这个具体说法的唯一保留处**（用户 2026-08-20 逐字裁定：文档中的
描述仅保留一处并说明已被证明是错的，其余删除以减少噪音，并去除基于这一假设的实现）。实现去除见
`tasks/gap-subagent-turn-budget-13min-falsified`（fan-in-execute.js 的「短命轮询 agent + 脚本 setTimeout」
改为「单个阶段 2 agent 本回合内多次 <600s Bash 循环等 suite」）。

**三条证据链（a8 提供，可复算）**：
① **会话历史直接反证**：inner（2b140e8a）29 个直属 subagent，15 个 >10min、14 个 >13min、最长
   38.7min，抽查全程连续真实 tool_use、正常完成（非截断）。
② **官方无此限制**：只有 Bash 单次调用 600s 硬顶是真的（文档化）；subagent 整体无文档化超时
   （GitHub #61405「Subagent delegation lacks timeout」）。
③ **本仓库引用的两份「~13min 实证」逐份打开都不是超时**：`wf_c6f4d0ef-c6a` 13.6min 正常完成
   （bracketClosed:false 是设计内诚实标注，非超时截断）；`wf_1072dc43-893` 末尾是「user rejected /
   interrupted by user」= 人为中断，与计时器无关。

**⇒ 对上方正文的修正**：suite 实测 19+ min 仍 > Bash 单次 600s 硬顶，所以 detached suite + 跨多次
<600s Bash 等待仍成立；被证伪的只是「必须把等待整个搬出 subagent 回合、每轮起一个新短命轮询 agent」
这个激进形状——单 subagent 能连续跑 30+ min 上百次工具调用（证据①），阶段 2 agent 自己循环等即可。
AC1 的「回合预算承载」实现已相应简化（见 `gap-subagent-turn-budget-13min-falsified`）。
