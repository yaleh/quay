---
id: gap-worker-print-bg-wait-ceiling-600s
title: worker 反复 exited-not-landed 根因：行为分叉——worker 结束回合等通知 vs 回合内轮询（-p 600s
  天花板只掐前者）→ 根修 buildWorkerPrompt 强制回合内等 + PRINT_BG_WAIT_CEILING_MS=0 防御 + driver
  外部超时
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**根因（manager 2026-08-24 确证 + 当日收窄，人已裁定立即立案）**：worker 反复 exited-not-landed 的根因是**行为分叉**，不是算术上限：

**初版断言（已撤回）**：「算术上必死——fan-in 链光 suite 就 517s 逼近 600s 天花板」。**反例推翻**：`gap-worker-driver-cold-start-inflight-blind` 的 worker 墙钟 **4082s（68min）**、`final_state=completed` 正常落地（0adbfbc4）——68 分钟远超 600s，「算术必死」不成立。

**收窄后的正确根因（两组对照证实，同一判据结论相反）**：
```
成功组 cold-start-inflight-blind（68min, completed）
  transcript grep -c "Background tasks still running" = 0        ← 一次都没撞
  Bash 调用 91 次，sleep 100 出现 33 次                          ← 典型的【回合内轮询】签名

失败组（driver 日志实证）
  worker 原话："fan-in workflow 正在后台跑，I'll wait for its completion notification..."
  紧接着："Background tasks still running after 600s; terminating." ← 结束回合 ⇒ 600s 后被终止
```
- **`claude -p` 的 600s 天花板只在 worker【结束本回合】而后台 fan-in 仍在跑时触发**；留在回合内轮询的 worker 完全免疫。
- **回合内等正是本仓库既有设计**：`plugin/workflows/fan-in-execute.js:3`「全量 suite 的【等待】由阶段 2 agent **在本回合内多次 <600s Bash 循环**承担…subagent 在 ff 成功后才返回」。**失败的 worker 偏离了已文档化的设计，不是撞上不可避免的物理上限。**
- **缺陷的使能者**：`worker-driver.ts:598 buildWorkerPrompt` 只写「(4) ff-merge via fan-in-execute workflow」，**没有规定必须在回合内等**——等法由模型自由裁量 ⇒ 有的 sleep 循环留在回合内（活）、有的说「我等通知」就结束回合（600s 后死）。

**⚠️ 关键**：此修复 2026-08-16 已裁定，从未落地。`orchestration/SPEC-worker-driven-inner-2026-08-16.md:31`：「设 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`」+「驱动有外部超时（单任务墙钟）。超时即杀 worker 会话，但保留 worktree。」全仓 `grep -rn "PRINT_BG_WAIT_CEILING"` ⇒ 仅 SPEC 一行，零实现。

## Plan

三件，层次明确：

**(c) 根修——worker prompt 强制回合内等**（本轮新增，主修法）：`worker-driver.ts:598 buildWorkerPrompt`（单一真相源，改一处覆盖所有 worker）明确要求：「fan-in 在飞期间**不得结束回合**，须在回合内多次 <600s Bash 轮询直到终态（final_state 落定）」。这是对已文档化设计的强制执行，堵住「结束回合等通知」的分叉。

**(a) 防御纵深——设 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`**：`_launchSpec.roles["task-worker"].env`。定位从「唯一修法」降为**防御纵深**（不管模型怎么选等法都不会被 600s 掐）。⛔ 落地注意：改 launch.settings.json 动到 `quay-launch.sh` 的 `SETTINGS_ARG` 分支（角色级 env 合并成 JSON 字符串传 --settings），别破坏空串=删键语义。

**(b) 兜底——driver 外部墙钟超时**：`worker-driver.ts` `--timeout <ms>`（当前缺省 0=无超时）。⛔ 只做 (a) 不做 (b) 会把「600s 必死」换成「真跑飞的任务永久占槽」；原裁定要求「超时即杀 worker 会话，**但保留 worktree**」。

## Acceptance Criteria

- [ ] AC1（能取假，根修 (c)）：`buildWorkerPrompt` 输出含「fan-in 在飞期间不得结束回合、须在回合内轮询直到终态」的明确指令（grep buildWorkerPrompt 返回模板命中），且一个真实 worker 落地窗口内**无** worker 结束回合等通知。
- [ ] AC2（能取假，防御 (a)）：**活 worker 进程** env 含 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`（`tr '\0' '\n' < /proc/<worker-pid>/environ` 可查；⛔ 只改配置文件不算——必须是活进程读得到）。
- [ ] AC3（能取假，兜底 (b)）：driver 外部墙钟超时生效，且**超时后 worktree 保留**（⛔ 误删 worktree ⇒ 假）。
- [ ] AC4（负控制）：修复后落地窗口内，落地 worker 的 transcript 中 `Background tasks still running` 计数 = 0，且 `exited-not-landed` 占比显著下降（**基线：最近 1h 6/7 = 86%**；修复后应 <30%）。

## Definition of Done

- [ ] AC1-4 全勾；(c)(a)(b) 三件都落地到 develop；生产 worker 进程 env 实测含该变量；一个 >600s fan-in 的任务正常落地（transcript 无 end-turn 形态）。

## Retires

- 无（关联：gap-worker-driver-periodic-exit-resident 已重定范围为文档化；本任务管 -p 后台等待 + 行为分叉）

## Touches

- plugin/scripts/worker-driver.ts（buildWorkerPrompt 强制回合内等 + --timeout 接线）
- .claude/launch.settings.json（_launchSpec.roles["task-worker"].env 加 PRINT_BG_WAIT_CEILING_MS=0）
- plugin/scripts/quay-launch.sh（SETTINGS_ARG 分支核对，勿破坏空串=删键语义）
- tasks/gap-worker-print-bg-wait-ceiling-600s.md（自身）