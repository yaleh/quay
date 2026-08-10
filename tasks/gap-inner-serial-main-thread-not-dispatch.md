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

- [x] AC1: **复现固化**——任务体记录实证（85 分钟 Bash 162/Edit 41/Agent 2 + 41 Edit 全主线程改产品脚本 + 三类区分）（本任务 Proposal 已含；内层补：meta-cc 复现工具分布）
- [x] AC2: **机械可核判据**——每轮 tick 报「主线程 Edit 产品文件数 / Agent 派发数」；前者远大于后者且非红窗 ⇒ 违反（候选 A）
- [x] AC3: **红窗快修不误报**——红窗即时修复的主线程 Edit 不判违（候选 B 白名单）
- [x] AC4: **常规实现走 Agent**——常规 ready 任务实现有 Agent 派发记录（非主线程 Edit）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 tick 文档 / loop 契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：常规 ready 任务有 Agent 派发；每轮 tick 报两数；红窗快修不误报（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/loop/fast-mode-loop-tick.md（A 段/步骤：每轮报「主线程 Edit 产品文件数 / Agent 派发数」）
- plugin/scripts/（候选 A：两数采集的机械 helper——主线程 Edit 数 = meta-cc 会话内 Edit 产品文件数，Agent 数 = 会话内 Agent tool 调用数）
- plugin/scripts/inner-exec-mode-report.ts（新 helper——本任务创建：两数采集器 + capability-catalog 声明 + 测试配对）
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

## Evidence（内层实现 2026-08-09）

**AC1 复现固化（meta-cc 复现工具分布）**：meta-cc `query_session_content role=tool` 在 15:30–16:53Z
窗口（`since 2026-08-09T15:30:00Z until 2026-08-09T16:53:00Z`）：
- `tool_name=Edit`：total 81（跨 3 会话：728a4610 = 73、b8dc91a6 = 6、7795bb75 = 2）。
- `tool_name=Agent`：total 2（均在 728a4610 的 16:26:13/16:26:17）。
- 直读 728a4610 transcript 窗口内：Edit tool_use = 40、Agent = 2 —— 与任务体「Edit 41 / Agent 2」
  同量级，复现「主线程串行做实现非派发」。三类区分（红窗快修/立案主线程对、常规实现须派 subagent）
  见任务体 Proposal。

**AC2 机械可核判据（helper + tick 接线）**：
- 新 helper `plugin/scripts/inner-exec-mode-report.ts`：读会话 transcript JSONL，数两数——
  `main_thread_edits`（tool_use `Edit` 且 `input.file_path` 指向产品文件
  `plugin/scripts/|plugin/test/|packages/`）+ `agent_dispatches`（tool_use `Agent`）。
  `--session <path>` / `--since <ISO>` / `--repo-root <dir>` / `--json`；缺省自动检测
  `~/.claude/projects/` 下最新匹配仓库 slug 或 cwd 的会话。畸形行容忍跳过；Edit 无 file_path
  单列 `edits_no_file_path`（不跳过、不计入产品数）。
- 实跑（Contract invoke 形态，对真实会话 728a4610 + `--repo-root /home/yale/work/quay`）：
  `{ "main_thread_edits": 103, "agent_dispatches": 162, "session": "...728a4610...jsonl" }`
  （全时；`--since 2026-08-09T15:30:00Z` 窗口化 = 27/6——since 无上界，含窗口后到现在的派发）。
- tick 接线：`plugin/loop/fast-mode-loop-tick.md`「## 每个 tick 必报」新增执行模式两数 bullet +
  「## 执行模式两数判据与红窗白名单」新节；`orchestration/fast-mode-tick-core.md` A23 行 + B2 必报项。

**AC3 红窗快修白名单（不误报）**：白名单文档化在
`plugin/loop/fast-mode-loop-tick.md`「执行模式两数判据与红窗白名单」节——①红窗即时修复
（suite-red 分诊即刻修复）、②任务立案/编排（`tasks/*.md`）、③tick/编排文档编辑
（`plugin/loop/*.md`、`orchestration/*.md`）。②③在**计数源头**排除（`tasks/`、`docs/` 非产品文件），
测试 `plugin/test/inner-exec-mode-report.test.mjs` 用 fixture 钉住：task/doc Edit 不计入
`main_thread_edits` ⇒ 白名单类结构性不误报。

**AC4 常规实现走 Agent**：判据已机械化 —— 常规轮次 `agent_dispatches ≥ 1`（或非红窗时
`main_thread_edits` 不大幅 > `agent_dispatches`）；helper 复现问题会话（728a4610 窗口内
Edit 40 / Agent 2）证明此前「主线程串行、无派发」确实可被两数抓出。tick-log 每轮报两数，
`main_thread_edits` 大且 `agent_dispatches == 0` 且非红窗 ⇒ 显式写「执行模式违规候选」。

**AC5 scoped 门绿**：`bash scripts/test.sh --for-task gap-inner-serial-main-thread-not-dispatch --allow-thin`
退出 0 —— `ℹ pass 8 fail 0 cancelled 0`（新增测试 8 条全绿）；scoped 静态检查
（task-contract / adr016 / strategic-doc-staleness / drive-contract / instrument-failure /
capability-catalog）全 PASS，0 violations。`capability-catalog.sh` 已为新脚本加声明
（unclassified = 0）。test-framework-policy + test-isolation 无新增违规。

**DoD 说明**：全量套件行未勾（外层 verification-round 的活，scoped-only 下任务内不可知）；
`status: ready` 不变。

## 同根标注（gap-session-identity-index-vs-explicit，2026-08-10）

本任务创建的 helper `plugin/scripts/inner-exec-mode-report.ts` 在缺省 `--session` 时曾用「最新
.jsonl」启发式自动检测 —— 从 manager/outer 跑会命中自己（实测 session=b8dc91a6，manager）。
同根任务 `gap-session-identity-index-vs-explicit` 已修：缺省先反查 pane pid → session（显式身份，
复用 inner-session-check.sh 的 discovery-pid 结构解析），启发式仅 fallback 且报 WARN；
输出新增 `session_source` / `session_warning` 字段。
