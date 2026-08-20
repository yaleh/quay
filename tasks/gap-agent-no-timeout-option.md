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

- [x] AC1: poll 有界阻塞等待的硬边界必须 ≥ suite 时长——机械判据：读真实 poll 配置（`firstDelayMs 660s + pollBlockSeconds 540s = 1200s ≥ 实测 19+ min ≈ 1140s`），不得收窄到 < Bash 工具默认时限 120s 而牺牲 suite 覆盖（b187d84a 100s 回退教训：poll 在 suite 结束前超时 ⇒ fan-in 误判「suite 异常」→ release → relaunch 无限循环）。**同时文档注明 agent() 无 timeout/bashTimeout 旋钮的局限**（Workflow 工具 opts 仅 {label, phase, schema, model, effort, isolation, agentType}——加旋钮是 Claude Code 特性请求、本仓库改不了）；有界阻塞等待落在 Bash 工具的时限上、是纯语言请求，**兜底 = suite 以 detached 方式运行**（setsid + & + disown）：poll agent 的 timeout 只界它自己看 marker 的时长、不界 suite 生命周期，即使 poll 被 Bash 默认 120s kill 提前返回 not-done，suite 继续跑、脚本 setTimeout 循环再轮询。
- [ ] AC2: 负控制落在生产载体——一个真实 fan-in suite 全绿（读生产 journal / 工作流 record，非 fixture）且 bracket 正常关闭、worktree remove、flip done。验证「poll 硬边界 ≥ suite 时长」在生产真正生效，不依赖 fixture 注入。（待外部）
- [x] AC3: scoped 绿 + 取假测试——把 poll 边界设 < suite 时长（如 pollBlockSeconds=100）时测试红（证明「≥ 地板」判据不是恒真、非推理）；生产默认配置（firstDelayMs 660 + pollBlockSeconds 540 ≥ 1140s）测试绿。

## Definition of Done

- [ ] poll 的「有界阻塞等待 ≥ suite 时长」在生产真正生效：默认 poll 配置覆盖单次 suite（机械判据绿）、agent() 无 timeout 旋钮的局限已文档化（detached suite 兜底）、一个真实 fan-in suite 绿（读生产 journal 非 fixture，AC2）。（待外部）

## Evidence

**2026-08-20 回退记录（诚实账）**：`b187d84a` 曾尝试把 `pollBlockSeconds ?? 540` 收到 `?? 100`（< Bash 工具默认 120s，留 20s 余量），AC 一度全勾。外层裁定：poll 100s < suite 时长（19+ min）⇒ fan-in 误判「suite 异常」→ release → relaunch 无限循环 ⇒ 回退。本提交把双拷贝 `fan-in-execute.js` 恢复 `pollBlockSeconds ?? 540`、⑩ wiring 取假断言恢复 `timeout 540 / < 600 / === 540`。AC 重新打开（实现方向错了不硬勾）。正确修法仍在 AC1 两条路径，新增约束「等待能力 ≥ suite 时长」。

**2026-08-20 重写 AC（外层裁定：agent() 无 timeout 旋钮，仓库改不了）**：外层裁定 `agent()` 工具的 opts 仅 {label, phase, schema, model, effort, isolation, agentType}——没有 timeout/bashTimeout 旋钮，「加旋钮」是 Claude Code 特性请求、quay 仓库改不了。⇒ AC 从「加旋钮」改为「正确 poll 边界 + 文档局限」：
- AC1：poll 硬边界 ≥ suite 时长（机械判据，读真实 poll 配置 `firstDelayMs 660 + pollBlockSeconds 540 = 1200 ≥ 1140s`），+ 文档注明 agent() 无 timeout 旋钮的局限（用 Bash timeout + detached suite 作为兜底等待——detached 让 poll agent 的 timeout 只界它自己看 marker、不界 suite 生命周期）。
- AC2：负控制落在生产载体（真实 fan-in suite 绿、bracket 关、worktree remove，读 journal 非 fixture）——impl 阶段做不了全量 suite，标 `（待外部）`。
- AC3：scoped 绿 + 取假测试（poll 边界 < suite 时长时测试红，`plugin/test/fan-in-execute-paths.test.mjs` 新增 ⑩d 组：默认配置 1200 ≥ 1140 断言绿；pollBlockSeconds=100 override 时同一谓词判 760 < 1140，证明「≥ 地板」不是恒真）。

## Touches

- tasks/gap-agent-no-timeout-option.md（自身）
- plugin/workflows/fan-in-execute.js（等待设计改造或 agent() 旋钮接线；双拷贝同步）
- .claude/workflows/fan-in-execute.js（与 plugin/workflows 同步，字节一致）
- plugin/test/fan-in-execute-paths.test.mjs（取假测试）
