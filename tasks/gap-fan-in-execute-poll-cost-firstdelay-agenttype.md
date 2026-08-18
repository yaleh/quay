---
id: gap-fan-in-execute-poll-cost-firstdelay-agenttype
title: "fan-in-execute 轮询成本削减——firstDelayMs 起轮延迟 + suite-poller 瘦身 agentType（两条零风险杠杆，无设计变更）"
status: todo
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

- [ ] AC1: fan-in-execute 增加 `firstDelayMs`（默认 ~660s），首轮延迟后仍按 `pollIntervalMs` 轮询；无设计变更、无新失败模式；`pollIntervalMs=0` 测试 seam 照旧可用。
- [ ] AC2: 定义 `suite-poller` agentType（`.claude/agents/suite-poller.md`，只带 Bash 工具），轮询 agent 改用该 agentType，单次轮询 cache_read 基线下降（工具 schema 那 ~64k 的大部分砍掉）。
- [ ] AC3: 负控制——真实 suite 等待的轮询次数从 ~21 降到 ~10（firstDelayMs 生效），且 scoped 测试绿。

## Definition of Done

- [ ] 一轮真实 suite 等待：轮询 agent 次数显著下降（firstDelayMs）+ 单次 cache_read 基线下降（agentType），scoped 绿（真实输出，非 fixture）。

## Touches

- tasks/gap-fan-in-execute-poll-cost-firstdelay-agenttype.md（自身）
- plugin/workflows/fan-in-execute.js（firstDelayMs + agentType 参数）
- .claude/workflows/fan-in-execute.js（与 plugin/workflows 同步）
- .claude/agents/suite-poller.md（新增——瘦身 agentType 定义）
- plugin/test/fan-in-execute-paths.test.mjs（firstDelayMs / agentType 覆盖）
