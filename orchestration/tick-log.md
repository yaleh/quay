# 外层 tick 记录

每 20 分钟一行。`动作类型` 是判断分层是否退化的唯一依据（`correct` 占比 ≥50% = 内层自主性不足）。

| 时刻 | 动作类型 | 做了什么 | 内层状态 | 核实了哪一项 |
|---|---|---|---|---|
| 2026-08-02 ~16:10Z | `escalate` | **推翻了上一 tick 自己的结论**：A2/A5 不是「从未落地」，是**做完验收后 Land 从未合并**——`git worktree list` 查出 4 个分支带 **24,989 行未合并工作**（M243 +8351 / M246 +9161 / M239 +6901 / M222 +576），全部滞留 2026-08-01，`merge-tree` 全部无冲突。已更正复核文档与 A2/A5 任务体；升级 escalations #2（合并是落地决定，且 M222 与在飞的 B5-1 同改 `cli.test.mjs`）；建任务 `gap-stranded-worktree-branches-have-no-alarm-channel` | B5-1 在飞 22 分钟（阈值 90），subagent 在改 AC12 | 我的复核脚本**只查 master 工作树、从不看分支**——在 Land 走 worktree 分支的流水线里，「做了没有」不能只问 master。这个方法论缺陷比复核发现的任何一条都重要 |
| 2026-08-02 ~15:45Z | `correct` | 按人的裁定（escalations #1 选项 A）做 DIR-124 全链复核，22 个任务机械核查 → `orchestration/dir-124-chain-audit.md`。**真阳性是两个不是一个**：A2 + **A5**（同形态：done + AC 零勾 + 代码零落地），状态均改回 `todo`；不排期（是未开工的 B/C/D/E 的前置，无回溯性损害）。拆掉 PARENT-DONE-IFF-CHILDREN 会让 DIR-124-A 带着假 done 子任务闭合的陷阱。明确不补勾 A1a/A3/A3a/A3b 的 AC——事后照代码补勾是制造证据 | B5-1 spawn-cli 仍在飞 | 复核脚本自身两个缺陷（反引号、`(new)` 后缀带空格被当散文丢弃）在过程中发现并修正——**第一版结果因此漏掉了 A5**，已记进复核文档 |
| 2026-08-02 ~15:15Z | `escalate` | 查证漂移检查器报的 5 个 reverse-drift-suspect：**A2 真阳性**（done 但 AC 全未勾、全仓无 `*workflow*replay*`）→ 升级给人（范围决定，escalations #1，建议选项 A）；**B1 假阳性**（run-identity 代码与测试都在，只缺 milestones/M253 簿记）→ 建任务 `gap-reverse-drift-check-buries-true-positives-in-noise`。消歧了授权表里「可补建任务」与「不可写 tasks/」的自相矛盾：`tasks/` 是队列不是代码，外层可写，前提是在飞任务的 Touches 不含 `tasks/`（已核 B5-1 不含） | B5-1 spawn-cli 在飞，subagent 在跑；遥测 inProgress=1 | **AC3 干净复测 8.0/8.1/8.6s**（内层声称 8.3s 属实；上次 23s 确为负载污染）；`inFlight` 是我读错的字段名，实为 `inProgress`，遥测无缺陷 |
| 2026-08-02 ~14:35Z | `unblock` | 内层问「是否派发两个 test-suite-cost 任务」后正常结束回合等答复——这正是外层该消费的停止条件。外层先误判为「指令掉 Enter」（输入框那行实为 ghost suggestion，人纠正），已改正步骤 0(a)。四个失败模式（ghost suggestion 误判 / 停摆判据看屏幕变化 / 外层核实抢 CPU / cron 对话期不 fire）写进 tick 步骤 0 | 内层空闲：3 个 B4 任务全部 done，自报套件 0 fail / 2128 tests；wall-clock 549s | 遥测 4 条 done + orphaned=0（核实通过）；**AC1 独立核实通过：全量套件 2128 tests / 0 fail / 18 skipped / 491s**（内层空闲时跑，未争 CPU）；并发资格复核 `checkTouchesPair` = `overlapping file-sets` → 两个 test-suite-cost 任务串行，已按 spawn-cli 优先派发；AC3 声称 8.3s，外层在套件负载下实测 23s——负载不同不构成反驳，待空闲复测 |
| 2026-08-02 ~13:25Z | `no-action` | 核实 AC3 达标；查明瞬时污染文件为文档化取舍，不建任务 | B4-1/B4-3 已合并，B4-2 在飞；内层在跑全量套件 | **AC3 实测 111s→10s**（要求 ≤30s，达标）；`tasks/T-ADR001-e2e-fixture.md` 是 adr-gate.test.mjs 有意写入真实 tasks/ 并在 finally 清理，readiness 的 clean-tree(L40) 在 suite(L76) 之前，顺序安全 |
| 2026-08-02 ~13:05Z | `no-action` | 核实并发资格，三对全部 disjoint；内层自主推进无需介入 | 3 个 subagent 并发在飞（B4-1/2/3，各约 11m），遥测在飞=3 | `checkTouchesPair` 实测三对 disjoint=true —— 并发派发合规，AC13 首次真实发生 |
| 2026-08-02 ~12:45Z | `no-action` | 核实内层两项声称，均通过；无需介入 | 内层运行中，AC2/AC4 已落地 | 声称1：3 失败 → 2 个 open 任务（按根因归并，正确）；声称2：readiness `test.sh` 引用 0→7，实跑因跑全量套件超 200s，行为符合预期 |
| 2026-08-02 ~12:30Z | `unblock` | 建立双层机制；告知内层前置阻塞项与推进顺序 | 内层在做 3 个既有失败建任务 + readiness suite-green | 前置 AC1/AC3/AC4 均未满足，实测 4 失败 / select-preflight 111s / readiness 无 test.sh 引用 |

## 累计分布

| 类型 | 次数 |
|---|---|
| no-action | 3 |
| unblock | 2 |
| correct | 1 |
| escalate | 2 |
