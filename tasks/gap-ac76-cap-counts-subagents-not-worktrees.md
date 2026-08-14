---
id: gap-ac76-cap-counts-subagents-not-worktrees
title: AC76 在飞的唯一读法 = inner 任务 subagent（人 07:3xZ cap 裁定 + 09:1xZ 推广：在飞不靠任务记录/worktree/遥测括号）
status: ready
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

**⚠️ 人 09:1xZ 推广裁定——「在飞」的判定本身也读 subagent（不止 cap）**：
逐字：「**在飞不应当靠任务记录，而应当查 inner 任务 subagent。任务只要使用既定的 status 跟踪状态。**」
```
⇒ 两个量各干一件事，不再有第三个：
  在飞   = 查 inner 任务 subagent（直接量）
  任务状态 = tasks/*.md frontmatter 的 status（既定跟踪）
```
**实测触发（manager 09:1xZ 取证）**：/live 显示 AC66/AC72/AC73 在跑，实际只有 AC76/AC78 在飞——`.workflow-events/` 四条记录形态完全相同（status 维度 done/ready 在遥测里不可区分）；`--task-end` 0/3 写过括号；三条 done 的 worktree 现读均已不存在而 /live 仍显示在跑 ⇒ **遥测 in-flight 维度结构上不可靠**。旧判定形态（遥测括号 `realInFlight`/`reconcileInFlight`/`detectClosedButLive`、`worktreeLeaks`、`closed_but_live`、`git worktree list` 逐条判）**全部退役为显式标注（AC48 判据2 做法，不删除）**。

**C24 复判清单（manager 已取证、依据被推翻判据落地的改动，逐条待本任务复判）**：
```
1. fast-mode-telemetry.ts   realInFlight/reconcileInFlight/detectClosedButLive/analyzeSlotStatus 的 in-flight 维度
                            （worktreeLeaks / closed_but_live / brackets_reflect_subagents 同族）
2. slot-refill.ts           in_flight_count 入参与 slots_free 推导
3. .quay/inner-wakeup-heartbeat.json  slots_free / should_refill / dispatchable_disjoint 的在飞输入
4. /live 与 observation 面   realInFlight 的消费端
5. A16/A16b --task-start 遥测括号的【在飞】用途（派发留痕用途另议）
6. manager A3               git worktree list 判在飞（代理量，同被否）
```
⇒ **判据：在飞一律查 inner 任务 subagent（直接量）；任务状态只走 tasks/*.md status；上述机件的在飞派生一律退役（显式标注不删除）。**

**止损（C21，manager 09:1xZ）**：不需要——理由读数：错的方向是【多报】不是【漏报】（/live 把 3 条 done 报成在跑）；多报只让派发偏保守，不造成并发超限或误派；当前 in_flight 真值 2、load1=1.98、cpu_some_avg10=0.00、mem_avail=8841MB，无可测代价。**结论绑该组读数**；若出现「因 /live 多报而不派发」实例须重判。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 slot-refill.ts:15-29（正本 + fallback）+ 三层执行核的 in-flight 读法。
2. 判据1：正本点名被计量对象 + 禁 worktree 代理（写进执行核）。
3. 判据2：第三方读法 = subagents/agent-*.jsonl 近 N 分钟有写入文件数。
4. 判据3：07:2xZ/07:4xZ 两条真样本回放红（worktree vs subagent 不一致）。
5. 判据4：报数带计法。
6. 判据（09:1xZ）：在飞唯一读法 = inner 任务 subagent；任务状态只走 tasks/*.md status；C24 清单 1-6 的在飞派生退役为显式标注。
7. 能取假：/live 三条 done 误报为在跑真样本回放红。
8. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：正本点名并发 subagent + 禁 worktree 代理。
- [ ] AC2 判据2：第三方读法 = subagents/agent-*.jsonl 近 N 分钟写入文件数（AC67 判据2 已证可用）。
- [ ] AC3 判据3 能取假：07:2xZ 高估 2 / 07:4xZ 低估 1 真样本回放必须红（D2）。
- [ ] AC4 判据4：报数带计法（在飞 subagent=M，worktree 另标）。
- [ ] AC5 判据（09:1xZ 推广）：在飞的唯一读法 = inner 任务 subagent（直接量）；任务状态只走 tasks/*.md status；C24 清单 1-6 的在飞派生（realInFlight/reconcile 家族、in_flight_count、heartbeat 在飞输入、/live 消费端、--task-start 括号在飞用途、manager A3 worktree 判）退役为显式标注（AC48 判据2 做法，不删除）。
- [ ] AC6 能取假：/live 三条 done（AC66/AC72/AC73）误报为在跑的真样本回放必须红（manager 09:1xZ 实测：done 与 ready 在遥测里不可区分）。
- [ ] AC7 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 在飞的唯一读法 = inner 任务 subagent（正本点名 + 禁 worktree/遥测括号代理）+ 第三方读法 + 真样本回放红 + 报数带计法 + C24 在飞派生退役显式标注。

## Touches

- plugin/scripts/slot-refill.ts（:15-29 注释/实现明确被计量对象；C24-2：in_flight 输入改 subagent 读法）
- plugin/scripts/fast-mode-telemetry.ts（C24-1：realInFlight/reconcile 家族 in-flight 维度退役为显式标注）
- plugin/scripts/inner-wakeup-heartbeat-check.ts（C24-3：在飞输入读法）
- plugin/scripts/（/live observation 消费端——C24-4）
- orchestration/orchestrator-tick-core.md（外层 A 段 in-flight 读法——C17 外层落盘；C24-6）
- orchestration/fast-mode-tick-core.md（内层 A12 in-flight 读法——C17 外层落盘）
- orchestration/manager-tick-core.md（manager A3 在飞读法——C24-6）
- plugin/scripts/（检查器 + 真样本回放 fixture）
- tasks/gap-ac76-cap-counts-subagents-not-worktrees.md（自身）

## Evidence

（落地后回填）
