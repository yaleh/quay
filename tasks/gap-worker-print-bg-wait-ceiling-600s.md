---
id: gap-worker-print-bg-wait-ceiling-600s
title: worker 反复 exited-not-landed 根因：claude -p end_turn 时存活后台任务的 600s
  宽限竞态（13/13 样本聚集 600.8-602.9s；43/77=56%）→ 主修 PRINT_BG_WAIT_CEILING_MS=0 +
  prompt 辅助 + driver 外部超时
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**根因（manager 2026-08-24 确证，两轮收窄后精确版；人已裁定立即立案）**：`claude -p` 印刷模式下，**「结束回合(`end_turn`)时仍有存活后台任务」状态有一个 600s 宽限期**，超时被干净终止（退出码 0），把 worker 在 fan-in 阶段掐死。

**精确机制（独立 subagent 交叉验证，纠正第一轮/第二轮误差）**：
- 600s 时钟**不是**「整个进程生命周期」、也不是只有打印 "Background tasks still running" 字符串时才触发——它是 `end_turn` 时有存活后台任务的宽限。
- **重置时钟的动作 = 回合内的 harness 感知活动**：`TaskOutput`（阻塞等待、留在回合内）或 `Monitor` 事件（fan-in journal 每来一个事件 = 新回合 = 时钟重置）。**单纯 `end_turn` 后等通知，无论等多久，都在 +600.8~602.9s 被杀，退出码 0。**
- **实证**：13/13 失败样本全部聚集在 600.8–602.9s；3 个真正干净完成的样本（无存活后台任务时 end_turn）0.5–5.8s 退出。
- **第二轮「68min 成功靠 sleep 轮询免疫」是错的**：那 33 次 sleep 在 workflow subagent transcript（`wf_.../agent-*.jsonl`），worker 自己的 parent session sleep-bearing Bash = 0；其真正存活机制是 03:15:22 一个 `Monitor` 事件重置时钟、03:15:29/30 才 end_turn——**4.9s 时间差险胜，不是轮询免疫**。
- **TaskOutput / Monitor 都不是可靠修法**（样本 TaskOutput 1/1 太小、Monitor 2/4=50%）。
- **发生率**：`.quay/worker-outcome.jsonl` 自 08-23 14:50 起 `final_state=exited-not-landed` **43/77 = 56%**，中位墙钟 31.2 分钟。
- **driver 已排除**：`--timeout` 缺省 0（未设置），所有死亡 `exit_code=0, signal=null`——杀手是 Claude Code 印刷模式本身，不是 driver。
- **旁证**：CLI 二进制（`~/.local/share/claude/versions/2.1.241`）`tsi=600000` 绑定 `RECOVERY_ABORT_TIMEOUT_MS`/`SUBAGENT_PARK_REASON`。

**⚠️ 关键**：此修复 2026-08-16 已裁定，从未落地。`orchestration/SPEC-worker-driven-inner-2026-08-16.md:31`：「设 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`」+「驱动有外部超时（单任务墙钟）。超时即杀 worker 会话，但保留 worktree。」全仓 `grep -rn "PRINT_BG_WAIT_CEILING"` ⇒ 仅 SPEC 一行，零实现。

## Plan

三件，层次明确（⚠️ 第三轮调整后）：

**(a) 主修法——设 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`**：`_launchSpec.roles["task-worker"].env`。**消除整个 600s 竞态**，不依赖模型选对等待方式（Monitor 只有 50% 命中率）。⛔ 落地注意：改 launch.settings.json 动到 `quay-launch.sh` 的 `SETTINGS_ARG` 分支（角色级 env 合并成 JSON 字符串传 --settings），别破坏空串=删键语义。

**(c) 辅助——worker prompt 提示回合内等**：`worker-driver.ts:598 buildWorkerPrompt` 加「fan-in 在飞期间尽量留在回合内（TaskOutput 阻塞等待）」。⛔ **只能算辅助，不能当根修**——模型即便选 Monitor 也只有 50% 命中率，prompt 引导不够可靠。

**(b) 兜底——driver 外部墙钟超时**：`worker-driver.ts` `--timeout <ms>`（当前缺省 0=无超时）。⛔ 只做 (a) 不做 (b) 会把「600s 必死」换成「真跑飞的任务永久占槽」；原裁定要求「超时即杀 worker 会话，**但保留 worktree**」。

## Acceptance Criteria

- [x] AC1（能取假，**主修法 (a)**）：**活 worker 进程** env 含 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`（`tr '\0' '\n' < /proc/<worker-pid>/environ` 可查；⛔ 只改配置文件不算——必须是活进程读得到，同「代码落地≠生产生效」）。
- [x] AC2（能取假，辅助 (c)）：`buildWorkerPrompt` 输出含「fan-in 在飞期间尽量留在回合内等」的提示（grep buildWorkerPrompt 返回模板命中）。
- [x] AC3（能取假，兜底 (b)）：driver 外部墙钟超时生效，且**超时后 worktree 保留**（⛔ 误删 worktree ⇒ 假）。
- [ ] AC4（负控制）：修复后落地窗口内，**end_turn 发生时无存活后台任务**（判据 = fan-in `journal.jsonl` 在 worker end_turn 时已写终态记录；⛔ 不是查 "Background tasks still running" 字符串——那是该机制的打印形式之一，不是本体）；且 `final_state=exited-not-landed` 占比显著下降（**基线 43/77 = 56%**；修复后应 <30%）。（待外部）

## Definition of Done

- [ ] AC1-4 全勾；(a)(c)(b) 三件都落地到 develop；生产 worker 进程 env 实测含该变量；一个 >600s 的 fan-in 任务正常落地（end_turn 时 journal 已终态）。（待外部）

## Retires

- 无（关联：gap-worker-driver-periodic-exit-resident 已重定范围为文档化；本任务管 -p end_turn 后台等待竞态）

## Touches

- .claude/launch.settings.json（_launchSpec.roles["task-worker"].env 加 PRINT_BG_WAIT_CEILING_MS=0）
- plugin/scripts/worker-driver.ts（buildWorkerPrompt 提示 + --timeout 接线）
- plugin/scripts/quay-launch.sh（SETTINGS_ARG 分支核对，勿破坏空串=删键语义）
- plugin/test/launch-settings.test.mjs（(a) PRINT_BG_WAIT_CEILING_MS=0 测试）
- plugin/test/worker-driver.test.mjs（(b)(c) timed-out 保留 worktree + 回合内等提示测试）
- tasks/gap-worker-print-bg-wait-ceiling-600s.md（自身）