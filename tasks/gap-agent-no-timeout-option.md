---
id: gap-agent-no-timeout-option
title: "Workflow agent() 无 timeout/bashTimeout 旋钮——poll 的 timeout 540 依赖 prompt 指令非代码保证"
status: todo
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

`Workflow` 工具的 `agent()` 签名是 `agent(prompt, opts?: {label?, phase?, schema?, model?, effort?, isolation?, agentType?})`——**opts 列表里没有 timeout/bashTimeout 选项**。而 poll-bounded 的 fix（`fan-in-execute.js:212` 的 `timeout 540 bash -c 'while [ ! -f marker ]'`）依赖「poll agent 的 Bash 工具时限 >540s」（prompt :202 明确要求「Bash 工具的执行时限须设大于 540s」），但这是【纯语言请求】，代码层没有任何机制能保证——agent 是否设长 timeout 全看模型解读。

即使 bootstrap 同步修好（第 10 条）、poll 命令确为 timeout 540，那个 timeout 540 的 Bash 命令也会被 Bash 工具默认 120s 时限 kill。所以 poll-bounded 的「有界阻塞等待」在「agent 内长阻塞」这个设计上，缺一个 `agent()` 不提供的旋钮。

## Acceptance Criteria

- [ ] AC1: 给 `agent()` 提供 timeout/bashTimeout 旋钮（向 Workflow 工具提需求），或换一种不依赖 agent 内长阻塞的等待设计（如把等待移到 workflow 脚本层，或用脚本 setTimeout + 短促只读）。
- [ ] AC2: 负控制落在生产载体——poll 命令的 timeout 540 被 Bash 工具【实际】允许跑满（读生产 journal 的 poll 时长，非 fixture）。
- [ ] AC3: scoped 绿 + 取假测试（把 timeout 机制去掉 ⇒ 测试红，证明非推理）。

## Definition of Done

- [ ] poll 的「有界阻塞等待 540s」在生产【真正】生效（Bash 时限有保证，非 prompt 请求），轮询 ~3 次（真实输出）。

## Touches

- tasks/gap-agent-no-timeout-option.md（自身）
- plugin/workflows/fan-in-execute.js（等待设计改造或 agent() 旋钮接线；双拷贝同步）
- plugin/test/fan-in-execute-paths.test.mjs（取假测试）
