---
id: gap-process-budget-counts-infra-as-test-concurrency-cap-pinned-1
title: "process-budget 的 in_use 把 MCP server / serve / 监视器算成测试并发——total=4 被 17 个基础设施进程钉死，effective_cap 结构性=1"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**process-budget.sh 的 `pgrep -xc node-MainThread` 把所有 node 主进程（含常驻 MCP server / web serve / 监视器）算进 in_use，而 total_budget=nproc=4——cap 被结构性钉死在 1，即使 band 是 GO（压力面正常）。**

**背景**：`gap-test-concurrency-cap-does-not-scope-nested-spawns`（done）引入 cross-layer total process budget（process-budget.sh，nproc-derived total=4），防止嵌套 spawn 超过机器容量。但它的计数口径有缺陷。

**实测（外层 2026-08-08 19:1xZ，manager 指出 cap 被 budget 钉死 + 三个问题归外层答）**：

**cap 决策**：`band: GO`（avg10=9.64，远低于 60 GO 阈值）而 **`budget: total=4 in_use=17~22 available=0`** ⇒ **`effective_cap=1`**（被 budget 钉死，非 band）。

**17 个 node-MainThread 分类（决定性）**：

| 类别 | 数量 | 可节流? |
|---|---|---|
| MCP server（`quay.js mcp` / `quay.ts mcp` / `quay-native mcp`） | 14 | **否**（各 claude 会话常驻基础设施，一个会话一个） |
| web serve（`quay serve --host --port`） | 2 | **否** |
| 监视器（`suite-state-trigger.ts --monitor`） | 1 | **否** |
| 套件 worker（`node --test`） | **0** | 是 |

**根因**：`process-budget.sh` 的 `in_use = pgrep -xc node-MainThread` **把所有 node 主进程算成「可节流的测试并发」**，而实际 17 个里 **0 个是测试 worker**——全是 MCP server / serve / 监视器。`total_budget=4` 只够 4 个基础设施，于是 available=0、cap=1。**计数口径把不该算的算进去了**——14 个 MCP server 是各 claude 会话的常驻 MCP（本会话 + inner + manager + 各 worktree 会话各一个），它们不是测试并发，不该计入「测试进程预算」。

**与 cap-avg300 缺陷同族**：信号把基础设施负载算进可节流量（cap-avg300 是会话 churn 顶 avg300；本缺陷是基础设施进程顶 in_use）。两条都导致 cap 结构性偏低、与真实派发负载无关。

**修的方向（实现归内层，方向外层已定）**：

- 候选 A：**计数口径排除基础设施**——`in_use` 只计可节流的测试进程（`node --test` 命令行 / test.mjs / full-suite-runner 派生的 worker），排除 MCP server / serve / 监视器（`*mcp*`、`*serve*`、`*suite-state-trigger*`、`*session-liveness*` 命令行）。
- 候选 B：**total_budget 区分基础设施与测试**——基础设施（MCP/serve/monitor）不计入预算（它们是常驻常数），只对测试并发设 nproc 上限。
- 候选 C：**按进程树归属**——只计「属于某个测试派发」的 node 进程（如 full-suite-runner / test.sh 派生的），排除独立起的 MCP/serve。
- 约束：**保留对真实测试超发的保护**（真并发跑 4+ 测试 worker 仍应降 cap）——修的是「基础设施不算」不是「预算移除」。

**验证锚**：修后，本机（14 MCP + 2 serve + 1 monitor + 0 测试 worker）`process-budget.sh` 报 `available >= 1`（GO，不钉死 cap）；注入真实测试 worker（跑 `node --test`）后 `available` 随测试并发下降。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录本机 17 个 node-MainThread 分类（14 MCP + 2 serve + 1 monitor + 0 测试），确认 `effective_cap=1` 由 budget 而非 band 导致（本任务 Proposal 已含）
- [ ] AC2: **计数口径修正落地**——process-budget 的 in_use 排除基础设施进程（MCP/serve/monitor），只计可节流测试进程，实跑验证
- [ ] AC3: **GO 带恢复**——本机（无测试 worker）`process-budget.sh` 报 available≥1、cap 不被钉 1，实跑输出贴任务体
- [ ] AC4: **过载保护保留**——注入真实 `node --test` worker 后 available 随并发下降（降 cap 仍生效），负控制
- [ ] AC5: **文档同步**——process-budget.sh 头注释更新计数口径（只计测试并发，基础设施为常驻常数）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：本机 cap 不钉 1（band GO 时 effective_cap≥3）；注入测试并发降 cap（两方向实跑贴任务体）
- [ ] 既有 resource-gate / process-budget 测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/process-budget.sh（in_use 计数口径：排除基础设施）
- plugin/test/resource-gate.test.mjs（process-budget 相关断言 + 新增）
- plugin/scripts/cap-from-gate.ts（若 budget 接入需同步）
- tasks/gap-process-budget-counts-infra-as-test-concurrency-cap-pinned-1.md（自身：勾 AC + 贴证据）

## 实跑证据（外层 2026-08-08 19:1xZ）

```bash
$ bash plugin/scripts/process-budget.sh
total_budget=4  in_use=17  available=0  verdict=WAIT

$ bash plugin/scripts/cap-from-gate.sh
signal: cpu_stall(some avg10)=9.64  bands(go<60, wait<85, extreme>=85)
band: GO  desired=GO  consecutive=0/2  switched=no
budget: total=4  in_use=18  available=0
effective_cap=1   # band GO 但被 budget 钉死

# 17 个 node-MainThread 分类：14 MCP server + 2 web serve + 1 监视器 + 0 测试 worker
# （各 claude 会话一个 quay MCP：本会话/inner/manager/worktree 会话；MCP 是常驻基础设施非测试并发）
```

## Contract

measure   cap_when_band_go = `bash plugin/scripts/cap-from-gate.sh` band=GO 时 effective_cap（应 ≥3，不再被 budget 钉 1）
band      cap_when_band_go = 5（GO 带；无测试并发时基础设施不计入 in_use）
invariant infra_excluded_from_budget = 1（MCP/serve/monitor 不计入 in_use，常驻常数）
invariant test_overload_still_gated = 1（注入真实测试并发仍降 cap，AC4 负控制）
invoke    `bash plugin/scripts/process-budget.sh`（实跑贴回）
control   无测试并发 ⇒ available≥1、cap≥3；注入 `node --test` ⇒ available 降、cap 降
resume    计数口径修正 + 测试 + 文档分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-08
changed: 建任务（manager 指出 cap 被 budget 钉死 + 三个问题归外层答；外层分类 17 进程确认口径缺陷；
方向已定候选 A/B/C，实现与测试归内层）
