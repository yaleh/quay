---
id: gap-inner-serial-main-thread-not-dispatch
title: inner 执行模式是主线程串行做实现非派发——85 分钟 Edit 41/Agent 2，吞吐恒 1、槽位账全假（OB-SLOT
  测错对象）；常规 ready 任务实现须派 subagent，主线程只做红窗快修+编排+立案
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**inner 的执行模式是「主线程串行做实现」，不是「派发并行」——85 分钟（15:30-16:53）工具调用分布：Bash 162 / Edit 41 / Read 21 / Agent 2。41 次 Edit 全在主线程，改的是产品脚本本体（ready-pool-check.ts ×9、measure-trend-check.ts ×5+测试×4、outer-tick-log-check.sh ×3、supervisor-bus-identity.sh ×1、scripts/test.sh ×1）；85 分钟只派了 2 个 Agent。后果：①吞吐恒等于 1（池里 dispatchable_disjoint=11 条互不冲突可并发，用不上）；②槽位账全假（数 subagent，而工作根本不在 subagent 里——outer/manager 关于「空槽」的对话测的是不承载工作的量）；③inner 不是没槽才串行，是压根不走派发路径。**

### 实证（manager 2026-08-09 meta-cc 核实 + 人看屏幕）

- **工具分布**（85 分钟）：Bash 162 / Edit 41 / Read 21 / Agent 2。41 次 Edit 全在主线程，改产品脚本。
- **Agent 派发极少**：85 分钟 2 次（16:26 两条）。
- **三个后果**：吞吐恒 1、槽位账假（OB-SLOT 8 轮「空槽」义务测错了对象）、inner 不走派发路径。
- **要区分两类**（别一刀切）：
  - (a) **红窗即时修复**在主线程做是**对的**（文档写明的快路径，measure-trend/ready-pool 那几次属此类）。
  - (b) **写任务体/立案**在主线程也**对**。
  - (c) **产品脚本的常规实现**在主线程做是**错的**——那是 subagent 的活（ready-pool-check.ts ×9、supervisor-bus-identity.sh 属此类）。
- **判据**：不是「禁止主线程 Edit」，是「**常规 ready 任务的实现必须派 subagent；主线程只做红窗快修 + 编排 + 立案**」。

**为什么重要**：这是 inner 吞吐恒等于 1 的机制根——池里 11 条可并发但只跑 1 条。同时让槽位账（OB-SLOT）测错对象，outer/manager 据此做的所有「空槽」判断都虚。需机械可核判据，不是散文纪律。

### 修的方向（实现归内层）

- 候选 A：**每轮 tick 报两个数**——「本轮主线程 Edit 产品文件数」与「本轮 Agent 派发数」；前者远大于后者且当轮非红窗 ⇒ 违反（机械可核）。
- 候选 B：**主线程 Edit 白名单**——红窗即时修复（文档写明的快路径）的产品文件 Edit 允许主线程；常规 ready 任务实现必须经 Agent。
- 候选 C：**例行记录**——inner tick-log 每轮记「主线程 Edit 数 / Agent 数」，供上层核对执行模式。

**验证锚**：修后，(a) 常规 ready 任务实现有 Agent 派发记录（非主线程 Edit）；(b) 每轮 tick 报两数（Edit/Agent）；(c) 红窗快修仍允许主线程（不误报）。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实证（85 分钟 Bash 162/Edit 41/Agent 2 + 41 Edit 全主线程改产品脚本 + 三类区分）（本任务 Proposal 已含；内层补：meta-cc 复现工具分布）
- [ ] AC2: **机械可核判据**——每轮 tick 报「主线程 Edit 产品文件数 / Agent 派发数」；前者远大于后者且非红窗 ⇒ 违反（候选 A）
- [ ] AC3: **红窗快修不误报**——红窗即时修复的主线程 Edit 不判违（候选 B 白名单）
- [ ] AC4: **常规实现走 Agent**——常规 ready 任务实现有 Agent 派发记录（非主线程 Edit）
- [ ] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 tick 文档 / loop 契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：常规 ready 任务有 Agent 派发；每轮 tick 报两数；红窗快修不误报（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/loop/fast-mode-loop-tick.md（A 段/步骤：每轮报「主线程 Edit 产品文件数 / Agent 派发数」）
- plugin/scripts/（候选 A：两数采集的机械 helper——主线程 Edit 数 = meta-cc 会话内 Edit 产品文件数，Agent 数 = 会话内 Agent tool 调用数）
- orchestration/manager-loop-tick.md（交叉标注——OB-SLOT 测错对象作废重立）
- tasks/gap-inner-serial-main-thread-not-dispatch.md（自身：勾 AC + 贴证据）

## Contract

measure   main_thread_edit_vs_agent = `node --no-warnings --experimental-strip-types plugin/scripts/inner-exec-mode-report.ts --json` 的 {main_thread_edits, agent_dispatches}（主线程 Edit 产品文件数 : Agent 派发数）
band      main_thread_edit_vs_agent = 常规轮次 agent_dispatches ≥ 1（或非红窗时 main_thread_edits 不大幅 > agent_dispatches）
invariant red_window_main_thread_edit_ok = 1（红窗快修主线程 Edit 不误报）
invariant regular_task_via_agent = 1（常规 ready 任务实现有 Agent 派发）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/inner-exec-mode-report.ts --json`（贴回两数）
control   常规任务有 Agent；红窗快修不误报；每轮报两数
resume    两数采集 + 判据 + 白名单分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager meta-cc 核实：inner 主线程串行做实现非派发——85 分钟 Edit 41/Agent 2，吞吐恒 1、槽位账假（OB-SLOT 测错对象）；三类区分（红窗快修/立案主线程对，常规实现须派 subagent）。机械判据=每轮报两数。实现归内层）
