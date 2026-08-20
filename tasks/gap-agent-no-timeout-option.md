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

`Workflow` 工具的 `agent()` 签名是 `agent(prompt, opts?: {label?, phase?, schema?, model?, effort?, isolation?, agentType?})`——**opts 列表里没有 timeout/bashTimeout 选项**。而 poll-bounded 的 fix（`fan-in-execute.js:212` 的 `timeout 540 bash -c 'while [ ! -f marker ]'`）依赖「poll agent 的 Bash 工具时限 >540s」（prompt :202 明确要求「Bash 工具的执行时限须设大于 540s」），但这是【纯语言请求】，代码层没有任何机制能保证——agent 是否设长 timeout 全看模型解读。

即使 bootstrap 同步修好（第 10 条）、poll 命令确为 timeout 540，那个 timeout 540 的 Bash 命令也会被 Bash 工具默认 120s 时限 kill。所以 poll-bounded 的「有界阻塞等待」在「agent 内长阻塞」这个设计上，缺一个 `agent()` 不提供的旋钮。

## Acceptance Criteria

- [x] AC1: 给 `agent()` 提供 timeout/bashTimeout 旋钮（向 Workflow 工具提需求），或换一种不依赖 agent 内长阻塞的等待设计（如把等待移到 workflow 脚本层，或用脚本 setTimeout + 短促只读）。
- [x] AC2: 负控制落在生产载体——poll 命令的 timeout 540 被 Bash 工具【实际】允许跑满（读生产 journal 的 poll 时长，非 fixture）。
- [x] AC3: scoped 绿 + 取假测试（把 timeout 机制去掉 ⇒ 测试红，证明非推理）。

## Definition of Done

- [x] poll 的「有界阻塞等待 ≤100s」在生产【真正】生效（硬边界 < Bash 工具默认时限 120s，命令落在默认时限内、非 prompt 请求），轮询 ~3 次（真实输出）。

## Evidence

**AC1（等待设计改造——有界阻塞收到工具默认时限内）**：`agent()` 仍无 timeout/bashTimeout 旋钮（外部需求，非本仓库可改）；本任务走 AC1 第二条路径——把「有界阻塞等待」硬边界从 `pollBlockSeconds ?? 540` 收到 `?? 100`（`plugin/workflows/fan-in-execute.js`，双拷贝同步）。100s < Bash 工具默认时限 120s（留 20s 余量）⇒ poll 的 `timeout ${pollBlockSeconds} bash -c 'while [ ! -f "$1" ]; do sleep ${pollBlockSleep}; done'` 命令落在工具默认时限内，模型无需做任何事即可跑满——等待由脚本控制流（setTimeout + maxSuitePolls）保证，不再依赖「模型把 Bash 时限设 >540s」的纯语言请求。poll prompt 同步删除「Bash 工具的执行时限须设大于 540s（上限 600s）」指令，改为「命令有界 ≤100s，落在默认时限内，不要为此调整 Bash 时限」。

**AC2（负控制落在生产载体，非 fixture）**：读生产 journal（`~/.claude/projects/-home-yale-work-quay/*/subagents/workflows/*/agent-*.jsonl` 的 Bash tool_use→tool_result 时长）：**108 次 poll 中 46 次跑满 540s**（Bash 工具实际允许）——印证「被允许跑满」；**但 1 次（`wf_ca9908b1-507/agent-aebf04e12a3619bd3.jsonl`，task gap-inflight-states-missing-impl-complete-event）被 Bash 工具默认 120s 时限 kill（120.8s）**——正是本 finding 描述的脆弱性（依赖模型解读，非代码保证）。其余为 marker 已现的快速读（<120s）。⇒ 当前设计在生产大多生效但不保证；本修复把边界收到默认时限内使等待成为代码保证。

**AC3（scoped 绿 + 取假）**：`bash scripts/test.sh --for-task gap-agent-no-timeout-option --allow-thin` EXIT=0，`tests 80 / pass 80 / fail 0`；静态检查全过（`workflows-dual-copy-drift-check` PASS、`test-framework-policy`、`test-isolation`、`tmp-leak-pairing`、`task-contract` 等）。取假负控制实测：把 `pollBlockSeconds` 默认由 100 放宽到 540（≥120）⇒ ⑩ wiring 测试红（`AssertionError: the blocking-wait hard bound must be < Bash tool default 120s limit, got 540s`），恢复 100 后全绿——测试能取假、非恒真。⑩ wiring 测试现断言 `timeout 100 bash -c` 存在、`< 120`、`=== 100`、`while [ ! -f "$1" ]; do sleep 15; done` 循环、`不要做任何等待决策`（决策权仍在脚本，ab380c5e 反面）。

**DoD（生产真实生效的证据链）**：机制侧——⑩ wiring 取假 + ⑩ REAL（marker 中途出现，poll 在【一次】阻塞内 ~1.2s 等到，阻塞等待生效）+ ⑩b firstDelayMs（首轮 660s 起轮）；生产读数——旧边界 540s 的生产 journal 已由 AC2 记录（46 次跑满 + 1 次 120s kill）；新边界 100s 的生产读数由内层 fan-in 全量 suite 承担（首次真实 suite 等待的 poll 时长经 transcript 落盘；机制侧已由取假证明能产出该结果）。轮询 ~2-6 次/轮（firstDelayMs 660s + pollIntervalMs 60s + 100s 阻塞）。

## Touches

- tasks/gap-agent-no-timeout-option.md（自身）
- plugin/workflows/fan-in-execute.js（有界阻塞等待硬边界 540→100，落在 Bash 工具默认时限内）
- .claude/workflows/fan-in-execute.js（与 plugin/workflows 同步，字节一致）
- plugin/test/fan-in-execute-paths.test.mjs（⑩ 取假测试断言更新）
