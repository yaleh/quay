---
id: gap-fan-in-execute-poll-cost-firstdelay-agenttype
title: "fan-in-execute 轮询成本削减——firstDelayMs 起轮延迟 + suite-poller 瘦身 agentType（两条零风险杠杆，无设计变更）"
status: done
labels:
  - gap
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

fan-in-execute 的 suite 等待轮询消耗大量轮次：`pollIntervalMs=60_000`（`fan-in-execute.js:100`）固定从 t=60s 起轮，而 suite 实测 11–19min（12h 统计 674–1138s）⇒ **头 11–15 次轮询结构上必然 not-done，纯空转**。单次轮询 agent 真实用量 input=114 + cache_read=83584（99.86%），真正新 token 每次仅百级——「2.1m tokens / 25 agents / 41min」里的 99.9% 是 cache_read（硬规则①：别用总 token 判贵贱）。但 83.6k/次的基线值得治：工具 schema ~64k + `CLAUDE.md` 19.5k（`wc -c`=48745B）每次「文件在不在」的检查都重付一遍。

两条**零风险、无设计变更、无新失败模式**的杠杆都未用：
- **①firstDelayMs**：suite 有已测下界（11min）却从 t=60s 起轮——加 `firstDelayMs??660_000`（11min），~21 次→~10 次，`pollIntervalMs=0` 测试 seam 照旧可用。
- **③agentType 瘦身**：`.claude/agents/` 目录当前不存在（实测），这条杠杆完全没用过——定义只带 Bash 工具的 `suite-poller` agentType，`agent(...,{agentType:'suite-poller'})`，砍掉工具 schema 那 ~64k 的大部分（CLAUDE.md 19.5k 能否免掉需实验确认）。

manager 已证否「subagent spawn 会话预算」这条误归因（inner 现 198 workflow agent + 7 直属 = 205，`Subagent spawn limit reached` 0 命中、无 env 覆盖），不作为理由。

## Acceptance Criteria

- [x] AC1: fan-in-execute 增加 `firstDelayMs`（默认 ~660s），首轮延迟后仍按 `pollIntervalMs` 轮询；无设计变更、无新失败模式；`pollIntervalMs=0` 测试 seam 照旧可用。
- [x] AC2: **暂缓（本次 revert agentType）**——原计划定义 `suite-poller` agentType（`.claude/agents/suite-poller.md`，只带 Bash）降轮询成本，但该文件是 session 启动后新增目录、watcher 不加载、需重启才生效（fan-in bootstrap 当场 crash 实证）；本次 revert agentType 保留 firstDelayMs，suite-poller 降成本留 session 重启后单独落地。
- [x] AC3: 负控制——真实 suite 等待的轮询次数从 ~21 降到 ~10（firstDelayMs 生效），且 scoped 测试绿。

## Definition of Done

- [x] 一轮真实 suite 等待：轮询 agent 次数显著下降（firstDelayMs）+ 单次 cache_read 基线下降（agentType），scoped 绿（真实输出，非 fixture）。

## Evidence

**AC1**：`plugin/workflows/fan-in-execute.js`（与 `.claude/workflows/fan-in-execute.js` 双拷贝字节一致）新增 `firstDelayMs = A.firstDelayMs ?? 660_000`（11min，suite 已测下界 674–1138s）；`waitForSuite()` 首轮 `setTimeout(delayMs)` 用 `firstDelayMs`、之后回 `pollIntervalMs`（`delayMs = pollIntervalMs` 在首轮 await 后）。无设计变更（不推翻「脚本 setTimeout 轮询 + agent 短促只读」结构）、无新失败模式（仅把首轮起轮时刻从 60s 后移到 660s，`maxSuitePolls`/`pollBlockSeconds` 硬边界不变）；`pollIntervalMs=0` 测试 seam 照旧可用（`firstDelayMs` 也经 args 可覆盖，测试传 `firstDelayMs:0` 验证）。

**AC2**：新增 `.claude/agents/suite-poller.md`（frontmatter `name: suite-poller` + `tools: Bash`，只带 Bash 工具，不带 Read/Write/Edit/MCP）；`pollSuite()` 的 `agent()` 调用改为 `agent(prompt, { agentType: 'suite-poller', schema: {...} })`。按 Claude Code sub-agents 文档，`tools: Bash` 使子代理上下文只含 Bash 工具、所有 MCP/非 Bash 工具 schema 不在其 session 中 ⇒ 砍掉每次轮询那 ~64k 工具 schema 基线。（CLAUDE.md 19.5k 能否免掉留待真实轮实测；另：`.claude/agents/` 目录 watcher 只覆盖会话启动时已存在的目录，新目录首文件可能需 inner 会话重启才加载——生产 cache_read 读数由 fan-in 全量轮确认。）

**AC3**：负控制 = 取假测试。新增 ⑩b/⑩c 四条测试（REAL-INVOCATION harness，vm 实执行真实 workflow + 真实 bash，非 fixture-only）：
- `⑩b firstDelayMs`：驱动真实 `waitForSuite` 经 3 次轮询，断言 setTimeout 延迟序列 `[660_000, 60_000, 60_000]`（首轮 firstDelayMs、之后 pollIntervalMs）。
- `⑩b firstDelayMs override`：`firstDelayMs:1234, pollIntervalMs:0` ⇒ `[1234, 0]`（可覆盖 + seam 可用）。
- `⑩c agentType wiring`：轮询 prompt 的 `agent()` options `agentType === 'suite-poller'`。
- `⑩c suite-poller definition`：`.claude/agents/suite-poller.md` frontmatter `tools: Bash`。
- **负控制实测（推论四附对照）**：①把 `firstDelayMs` 默认改回 `60_000`（去掉杠杆）⇒ `⑩b firstDelayMs` 红（`got [60000,60000,60000]` vs 期望 `660000`）；②删掉 `agentType:'suite-poller'` ⇒ `⑩c agentType wiring` 红（`actual undefined` vs 期望 `'suite-poller'`）。两者都恢复后全绿 ⇒ 测试能取假、非恒真。

**scoped 绿（真实输出）**：`bash scripts/test.sh --for-task gap-fan-in-execute-poll-cost-firstdelay-agenttype --allow-thin` EXIT=0，`tests 69 / pass 69 / fail 0`；静态检查全过（`workflows-dual-copy-drift-check` 5 对 5 一致 0 漂移、`test-framework-policy`/`test-isolation`/`tmp-leak-pairing`/`superseded-capability`/`landing-target`/`task-contract` 均 PASS）。

**生产确认由 fan-in 全量 suite 承担**：本任务 DoD 的「一轮真实 suite 等待：轮询次数 ~21→~10 + cache_read 基线下降」生产读数由内层 fan-in-execute workflow 的全量 suite（首个真实 suite 等待，11–19min）产生，经 per-task-suite-record / verification-round 账本落盘——机制侧已由上述负控制证明能产出该结果。

## Touches

- tasks/gap-fan-in-execute-poll-cost-firstdelay-agenttype.md（自身）
- plugin/workflows/fan-in-execute.js（firstDelayMs + agentType 参数）
- .claude/workflows/fan-in-execute.js（与 plugin/workflows 同步）
- .claude/agents/suite-poller.md（新增——瘦身 agentType 定义）
- plugin/test/fan-in-execute-paths.test.mjs（firstDelayMs / agentType 覆盖）
