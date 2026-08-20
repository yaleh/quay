---
id: gap-agent-no-timeout-option
title: "Workflow agent() 无 timeout/bashTimeout 旋钮——poll 的 timeout 540 依赖 prompt 指令非代码保证"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`Workflow` 工具的 `agent()` 签名是 `agent(prompt, opts?: {label?, phase?, schema?, model?, effort?, isolation?, agentType?})`——**opts 列表里没有 timeout/bashTimeout 选项**。而 poll-bounded 的 fix（`fan-in-execute.js:117` 的 `timeout 540 bash -c 'while [ ! -f marker ]'`）依赖「poll agent 的 Bash 工具时限 >540s」（prompt 明确要求「Bash 工具的执行时限须设大于 540s」），但这是【纯语言请求】，代码层没有任何机制能保证——agent 是否设长 timeout 全看模型解读。

即使 bootstrap 同步修好（第 10 条）、poll 命令确为 timeout 540，那个 timeout 540 的 Bash 命令也会被 Bash 工具默认 120s 时限 kill。所以 poll-bounded 的「有界阻塞等待」在「agent 内长阻塞」这个设计上，缺一个 `agent()` 不提供的旋钮。

### 2026-08-20 修正（外层裁定回退 100s 尝试）

**此前的 100s 尝试（`b187d84a`）已回退**：把 `pollBlockSeconds` 默认从 540 收到 100（< Bash 工具默认时限 120s）曾被当成「让 poll 命令落在默认时限内、等待即代码保证」。但 poll 的硬边界必须 **≥ suite 时长**（实测 19+ min ≈ 1140s；`firstDelayMs(660s) + pollBlockSeconds(540s) = 1200s` 才覆盖单次 suite）。100s 远小于 suite 时长 ⇒ poll 每次都在 suite 结束前超时返回 not-done，fan-in 据此误判「suite 异常」→ release → relaunch 无限循环（外层实测裁定）。**⇒ 判据是「poll 硬边界 ≥ suite 时长」，不是「< Bash 120s」。** 正确修法仍在 AC1 的两条路径里（agent() 旋钮 / 不依赖 agent 内长阻塞的等待设计），唯一新增约束是【等待能力必须覆盖整个 suite 时长】。

## Acceptance Criteria

- [ ] AC1: 给 `agent()` 提供 timeout/bashTimeout 旋钮（向 Workflow 工具提需求），或换一种不依赖 agent 内长阻塞的等待设计（如把等待移到 workflow 脚本层，或用脚本 setTimeout + 短促只读）。**poll 有界阻塞等待的硬边界必须 ≥ suite 时长**（实测 19+ min；`firstDelayMs 660 + pollBlockSeconds 540` 覆盖单次 suite）——不得收窄到 < Bash 工具默认时限 120s 而牺牲 suite 覆盖。
- [ ] AC2: 负控制落在生产载体——poll 命令的 timeout 540 被 Bash 工具【实际】允许跑满（读生产 journal 的 poll 时长，非 fixture）。这仍是本 finding 的核心脆弱点：实测 1/108 次 poll 被默认 120s kill（`wf_ca9908b1-507/agent-aebf04e12a3619bd3.jsonl`，task gap-inflight-states-missing-impl-complete-event）——「模型设长 Bash 时限」是纯语言请求，必须被代码机制消除或兜底。
- [ ] AC3: scoped 绿 + 取假测试（把 timeout 机制去掉 ⇒ 测试红，证明非推理）。

## Definition of Done

- [ ] poll 的「有界阻塞等待 ≥ suite 时长」在生产【真正】生效（Bash 时限有保证，非 prompt 请求），单次 suite 等待的轮询 ~1-3 次（真实输出，非 fixture）。

## Evidence

**2026-08-20 回退记录（诚实账）**：`b187d84a` 曾尝试把 `pollBlockSeconds ?? 540` 收到 `?? 100`（< Bash 工具默认 120s，留 20s 余量），AC 一度全勾。外层裁定：poll 100s < suite 时长（19+ min）⇒ fan-in 误判「suite 异常」→ release → relaunch 无限循环 ⇒ 回退。本提交把双拷贝 `fan-in-execute.js` 恢复 `pollBlockSeconds ?? 540`、⑩ wiring 取假断言恢复 `timeout 540 / < 600 / === 540`。AC 重新打开（实现方向错了不硬勾）。正确修法仍在 AC1 两条路径，新增约束「等待能力 ≥ suite 时长」。

## Touches

- tasks/gap-agent-no-timeout-option.md（自身）
- plugin/workflows/fan-in-execute.js（等待设计改造或 agent() 旋钮接线；双拷贝同步）
- .claude/workflows/fan-in-execute.js（与 plugin/workflows 同步，字节一致）
- plugin/test/fan-in-execute-paths.test.mjs（取假测试）
