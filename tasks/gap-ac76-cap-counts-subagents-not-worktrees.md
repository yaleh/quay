---
id: gap-ac76-cap-counts-subagents-not-worktrees
title: AC76 cap 的被计量对象 = 并发 subagent，禁 worktree 代理（人 07:3xZ 裁定）
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**AC76（cap 的被计量对象 = 并发 subagent，禁 worktree 代理 —— 人 2026-08-14 07:3xZ 逐字「cap=5 就是为了保护 subagent——inner 不能并发无限多 subagent。worktree 只是你找的又一个间接的表征量」）**。

**正本本来就写着，manager 没读**：`slot-refill.ts:15-16` 逐字「`slots_free = max(0, effective_cap - in_flight_count)`；调用方**显式传入 CURRENTLY-RUNNING subagent set**（`--in-flight`）——the INNER tick's own maintained set」。**⇒ 一整天用的 `git worktree list | grep -c` 既不是正本、也不是 `:22-29` 的 fallback（telemetry `--slot-status`），是 manager 自己发明的第三个读法。**

**偏差双向（今天两个方向都实测到，所以不是"保守地错"，是单纯地错）**：
```
07:2xZ   worktree 4 · 活跃 subagent 回合 2   ⇒ 高估 2
07:4xZ   worktree 1 · 活跃 subagent 回合 2   ⇒ 低估 1
```
**⇒ 高估时会在 subagent 预算实际空着时挡住派发**——今天几次「有空槽、有 ready 的 disjoint 任务、却没派」然后跑去查别处的原因：**拿一个错的量做判断，再去查判断之外的东西**。

**判据**：
- **判据1**：正本点名被计量对象（并发 subagent）+ 明写禁 worktree 代理。
- **判据2（第三方读法）**：`<session>/subagents/agent-*.jsonl` 近 N 分钟有写入的文件数（**AC67 判据2 已证可用**——agentId=subagent transcript）。
- **判据3（能取假，真样本 D2）**：用 worktree 判会与用 subagent 判不一致（07:2xZ 高估 2 / 07:4xZ 低估 1 两条真样本回放必须红）。
- **判据4**：报数带计法（`在飞 subagent=M`；`worktree` 若同时给必标明是另一个量）。

**不覆盖**：不改 `cap=5` 数值（人 08-09 已裁固定）；不新增槽位系统；不动 suite 槽（那保护 CPU，不是同一资源）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 slot-refill.ts:15-29（正本 + fallback）+ 三层执行核的 in-flight 读法。
2. 判据1：正本点名被计量对象 + 禁 worktree 代理（写进执行核）。
3. 判据2：第三方读法 = subagents/agent-*.jsonl 近 N 分钟有写入文件数。
4. 判据3：07:2xZ/07:4xZ 两条真样本回放红（worktree vs subagent 不一致）。
5. 判据4：报数带计法。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：正本点名并发 subagent + 禁 worktree 代理。
- [ ] AC2 判据2：第三方读法 = subagents/agent-*.jsonl 近 N 分钟写入文件数（AC67 判据2 已证可用）。
- [ ] AC3 判据3 能取假：07:2xZ 高估 2 / 07:4xZ 低估 1 真样本回放必须红（D2）。
- [ ] AC4 判据4：报数带计法（在飞 subagent=M，worktree 另标）。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] cap 被计量对象=并发 subagent（正本点名 + 禁 worktree 代理）+ 第三方读法 + 真样本回放红 + 报数带计法。

## Touches

- plugin/scripts/slot-refill.ts（:15-29 注释/实现明确被计量对象）
- orchestration/orchestrator-tick-core.md（外层 A 段 in-flight 读法——C17 外层落盘）
- orchestration/fast-mode-tick-core.md（内层 A12 in-flight 读法——C17 外层落盘）
- plugin/scripts/（检查器 + 真样本回放 fixture）
- tasks/gap-ac76-cap-counts-subagents-not-worktrees.md（自身）

## Evidence

（落地后回填）
