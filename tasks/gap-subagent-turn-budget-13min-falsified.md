---
id: gap-subagent-turn-budget-13min-falsified
title: "subagent ~13min 回合预算硬超时是假的——fan-in-execute.js 的短命轮询 agent 架构建立在证伪数字上，去重到一处 + 去该实现"
status: ready
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

fan-in-execute.js 的「短命轮询 subagent」（每轮起一个新短命 agent 等 suite，而非单个 agent 循环等）架构，唯一依据是「subagent 有 ~10-13min 回合预算硬超时」——**这个数字是假的，本仓库引用的两份「实证」打开后都不是超时**（a8 2026-08-20 逐份核实 + 用户逐字裁定）。

**用户裁定（逐字）**：「文档中的描述仅应保留一处并说明这已被证明是错的；其它应当删除以减少噪音；并去除基于这一假设的实现。」

**三条证据链（a8 提供，可复算）**：
① 会话历史直接反证：inner（2b140e8a）29 个直属 subagent，15 个 >10min、14 个 >13min、最长 38.7min，抽查全程连续真实 tool_use、正常完成（非截断）。
② 官方无此限制：只有 Bash 单次调用 600s 硬顶是真的（文档化）；subagent 整体无文档化超时（GitHub #61405「Subagent delegation lacks timeout」）。
③ 本仓库引用的两份「~13min 实证」逐份打开都不是超时：`wf_c6f4d0ef-c6a` 13.6min 正常完成（bracketClosed:false 是设计内诚实标注）；`wf_1072dc43-893` 末尾是「user rejected / interrupted by user」= 人为中断，与计时器无关。

**真实限制只有一个**：Bash 单次调用 600s 硬顶（官方文档化），与「subagent 整体运行时长」是两回事。**detached suite + 脚本控制流轮询仍成立**（suite 实测 19+ min，单次前台 Bash 必炸 600s）；**被证伪的只是「必须把等待整个搬出 subagent 回合、每轮起一个新短命轮询 agent」这个激进形状**——证据①显示单 subagent 能连续跑 30+ min 上百次工具调用，可能存在更简单的实现（阶段2 agent 自己循环发多次 <600s Bash 等 suite）。

## Acceptance Criteria

- [x] AC1: 证伪说明落在唯一一处——`tasks/gap-fan-in-turn-budget-suite-timeout.md` 补「2026-08-20 证伪」段（附①②③三条证据），其余文件删掉「~13min harness 强制收敛」这个具体说法（历史任务体叙述保留、不删文字，只删活文档里的误导性数字）。
- [x] AC2: 代码注释改准确——`fan-in-execute.js`（`.claude/` + `plugin/` 双拷贝）+ `plugin/test/fan-in-execute-paths.test.mjs` 里「~13min harness 强制收敛」改为准确表述「Bash 单次 600s 硬顶 + suite 实测 19+ min ⇒ 需跨多次调用等待」。
- [x] AC3: 架构简化评估 + 落地——把「短命轮询 agent（每轮起新 agent 等 suite）」简化为「单个阶段2 agent 自己循环发多次 <600s Bash 等 suite」，**负控制落在生产载体**（本任务自身的 fan-in 走新路径 suite 绿、bracket 关、worktree remove，读真实 journal 非 fixture）；实现已落地（见 Evidence），未发现不可替代理由。
- [x] AC4: scoped 绿 + fan-in-execute-paths.test.mjs 相关测试不红。

## Definition of Done

- [ ] 「~13min subagent 硬超时」只在唯一一处（源任务）保留并标注证伪，其余活文档删除；短命轮询 agent 实现被单个 agent 循环等替代（或写明不可替代理由），真实 fan-in 走新路径绿（真实输出，非 fixture）。

## Evidence

**实现决策（AC3）**：评估后【未发现不可替代理由】——旧「短命轮询 agent（每轮起新 agent 等 suite）+ 脚本
setTimeout」形状的唯一依据是被证伪的「~13min 回合预算硬超时」（Finding 证据①②③）。真实限制只有 Bash 单次
600s 硬顶 ⇒ 已落地为「单个阶段 2 agent 本回合内多次 <600s Bash 循环等 suite」：

- 删除 `pollSuite()`（每轮一个短命轮询 agent）与 `waitForSuite()`（脚本 setTimeout 循环）；阶段 2 prompt
  顶部新增等待块（自足 bash：有界阻塞等待 `timeout ${pollBlockSeconds}`(默认 540s) + `sleep ${pollBlockSleep}`(15s)，
  单次 < 600s 硬顶），POLL=not-done 就重跑同一块（最多 `${maxSuitePolls}`(默认 60) 次）。
- 覆盖判据从「firstDelayMs + pollBlockSeconds ≥ 时长」改为「maxSuitePolls × pollBlockSeconds ≥ 时长」
  （默认 60×540=32400s ≫ 实测 19+ min ≈ 1140s；`SUITE_FLOOR_SECS` 取假测试钉在
  `fan-in-execute-paths.test.mjs` ⑩b/⑩d）。
- 阶段 2 返回契约新增 `suite-red`（suite 退出码非 0，不执行机械步骤，脚本派 Fix agent 修复后重派阶段 2）
  与 `suite-not-done`（等待达上限仍无 marker，fail-closed 红）。
- Fix agent（读日志→修→重启动 detached）与 ff-retry 循环保留，仅等待方从「脚本派轮询 agent」改为
  「阶段 2 agent 自己循环」。detached suite（setsid+&+disown）不变。
- 双拷贝 `.claude/workflows/fan-in-execute.js` 与 `plugin/workflows/fan-in-execute.js` 保持 byte-identical。

**AC2 表述落点**：`fan-in-execute.js`（双拷贝）meta.description / phases / ⑦ 头注释 / 阶段 1 prompt /
阶段 2 prompt 与 `fan-in-execute-paths.test.mjs` 的 ⑧/⑩ 组注释，全部改为「Bash 单次 600s 硬顶 + suite
实测 19+ min ⇒ 需跨多次调用等待」；「回合预算」「~14-25min 超过 subagent 回合预算」等假前提措辞移除。

**AC1 唯一保留处**：`tasks/gap-fan-in-turn-budget-suite-timeout.md` 新增「2026-08-20 证伪」节（附①②③）。
`tasks/gap-direct-to-develop-exclude-cron-registry-receipt.md:67` 的「~13min harness 强制收敛」属历史任务体
叙述（AC1 允许保留）；`orchestration/manager-phase-goal.md:148` 已标「~13min 假前提」，非断言其为真。
本任务 Touches 之外的活文档（skill 描述经 fan-in-execute.js meta.description 随双拷贝更新）已由上述覆盖。

## Touches

- tasks/gap-subagent-turn-budget-13min-falsified.md（自身）
- tasks/gap-fan-in-turn-budget-suite-timeout.md（证伪说明段，唯一保留处）
- .claude/workflows/fan-in-execute.js（短命轮询 agent → 单 agent 循环等；双拷贝同步 plugin/workflows/fan-in-execute.js）
- plugin/workflows/fan-in-execute.js（同上）
- plugin/test/fan-in-execute-paths.test.mjs（负控制 + 注释改准确）
- plugin/scripts/（fan-in 相关脚本，若轮询逻辑在脚本控制流里）
