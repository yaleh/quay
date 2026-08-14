---
id: gap-ac76-cap-counts-subagents-not-worktrees
title: AC76 在飞的唯一读法 = inner 任务 subagent（人 07:3xZ cap 裁定 + 09:1xZ 推广：在飞不靠任务记录/worktree/遥测括号）
status: done
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

- [x] AC1 判据1：正本点名并发 subagent + 禁 worktree 代理。
- [x] AC2 判据2：第三方读法 = subagents/agent-*.jsonl 近 N 分钟写入文件数（AC67 判据2 已证可用）。
- [x] AC3 判据3 能取假：07:2xZ 高估 2 / 07:4xZ 低估 1 真样本回放必须红（D2）。
- [x] AC4 判据4：报数带计法（在飞 subagent=M，worktree 另标）。
- [x] AC5 判据（09:1xZ 推广）：在飞的唯一读法 = inner 任务 subagent（直接量）；任务状态只走 tasks/*.md status；C24 清单 1-6 的在飞派生（realInFlight/reconcile 家族、in_flight_count、heartbeat 在飞输入、/live 消费端、--task-start 括号在飞用途、manager A3 worktree 判）退役为显式标注（AC48 判据2 做法，不删除）。
- [x] AC6 能取假：/live 三条 done（AC66/AC72/AC73）误报为在跑的真样本回放必须红（manager 09:1xZ 实测：done 与 ready 在遥测里不可区分）。
- [x] AC7 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 在飞的唯一读法 = inner 任务 subagent（正本点名 + 禁 worktree/遥测括号代理）+ 第三方读法 + 真样本回放红 + 报数带计法 + C24 在飞派生退役显式标注。

## Touches

- plugin/scripts/slot-refill.ts（:15-29 注释/实现明确被计量对象；C24-2：in_flight 输入改 subagent 读法）
- plugin/scripts/fast-mode-telemetry.ts（C24-1：realInFlight/reconcile 家族 in-flight 维度退役为显式标注；C24-4 /live producer、C24-5 --task-start 括号在飞用途同盖）
- plugin/scripts/inner-wakeup-heartbeat-check.ts（C24-3：在飞输入读法）
- plugin/scripts/cap-counts-subagents-check.ts（new——AC76 检查器：判据1-判据6 + 真样本回放 fixture）
- plugin/test/cap-counts-subagents-check.test.mjs（new——测试：真样本回放红 + 负控制）
- plugin/scripts/capability-catalog.sh（new 脚本声明）
- scripts/test.sh（检查器注册）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY snapshot regenerated）
- orchestration/orchestrator-tick-core.md（外层 A 段 in-flight 读法——C17 外层落盘；C24-6，只建议不落盘）
- orchestration/fast-mode-tick-core.md（内层 A12 in-flight 读法——C17 外层落盘，只建议不落盘）
- orchestration/manager-tick-core.md（manager A3 在飞读法——C24-6，只建议不落盘）
- tasks/gap-ac76-cap-counts-subagents-not-worktrees.md（自身）

## Evidence

**判据1 —— 正本点名（AC1）**：`plugin/scripts/slot-refill.ts:15-21` 头部注释已改写为「THE MEASURED OBJECT (AC76, 人 2026-08-14 07:3xZ …) cap 的被计量对象 = 并发 subagent」+「⛔ 禁 worktree 代理 — `git worktree list | grep -c` is a FORBIDDEN proxy」+ 双向实测（07:2xZ wt=4/sub=2 高估 2；07:4xZ wt=1/sub=2 低估 1）。检查器判据1 `judgeSlotRefillCanonical` 对真实 slot-refill.ts 实测 GREEN（namesMeasured=true, forbidsWorktree=true）。

**判据2 —— 第三方读法（AC2）**：新检查器 `plugin/scripts/cap-counts-subagents-check.ts` 实现 `countActiveSubagentTranscripts(sessionDir, minutes)`——数 `<session>/subagents/agent-*.jsonl` 近 N 分钟有写入的文件数（AC67 判据2 已证可用，agentId=subagent transcript）。实测（65dc5943 session, --minutes 999999）：`in-flight-subagents=7`。

**判据3 —— 真样本回放红（AC3）**：检查器 `judgeWorktreeVsSubagent` 对两条真样本逐一回放 RED（exit 1）：
```
07:2xZ  worktree 4 · subagent 2  ⇒ "worktree-proxy-mismatch (worktree=4 ≠ subagents=2)"
07:4xZ  worktree 1 · subagent 2  ⇒ "worktree-proxy-mismatch (worktree=1 ≠ subagents=2)"
```
测试 `cap-counts-subagents-check.test.mjs` 将两条真样本 verbatim 固化并断言 RED（D2 不构造）。

**判据4 —— 报数带计法（AC4）**：检查器 `judgeReportLine` —— 负控制「在飞=worktree 4」（无 subagent 标）⇒ RED；真实 07:2xZ 行「worktree 4 · 活跃 subagent 回合 2」（两标齐备）⇒ GREEN（问题在用了哪个数，即判据3）。检查器 JSON 输出同时带 `in-flight-subagents=M`（计法）与 worktree 另标。

**判据5 —— 09:1xZ 推广 + C24 在飞派生退役（AC5）**：三处代码机件加 `RETIRED (AC76 C24-N …)` 显式标注（AC48 判据2 做法，不删除）：
- `plugin/scripts/fast-mode-telemetry.ts`（C24-1）：reconcileInFlight/detectClosedButLive/analyzeSlotStatus 与 realInFlight/closed_but_live/worktree_leaks/brackets_reflect_subagents 输出族 —— 在飞维度退役（A1a 事件 schema、--task-start/--task-end 派发留痕、throughput/blocked-wait/reconcile-cleanup 均保留）。
- `plugin/scripts/slot-refill.ts`（C24-2）：MEASURED IN-FLIGHT DEFAULT（telemetry --slot-status fallback）在飞读法退役（显式 --in-flight 路径不变）。
- `plugin/scripts/inner-wakeup-heartbeat-check.ts`（C24-3）：heartbeat 在飞输入退役；AC53 end-invariant 判据（读 slot-refill 新鲜输出）不变。
检查器判据5 `judgeC24Retirement` 对真实三文件实测 GREEN（`c24-in-flight-derivations-retired (3/3 annotated)`）。C24-4（/live observation 面）由 C24-1 对 producer 的标注覆盖 + 判据6 检查器捕获 done-误报在跑形态；C24-5（--task-start 括号在飞用途）由 C24-1 标注覆盖（派发留痕用途另议保留）。

**判据6 —— /live 真样本回放红（AC6）**：检查器 `judgeLiveVsTaskStatus` 对真实 fixture（AC66/AC72/AC73 三条 done 被 /live 误报在跑）回放 RED（exit 1）：`live-misreports-done-as-running (gap-ac66-ac-driven-behavior-change-verifiable,gap-ac72-cert-mechanism-retire,gap-ac73-catalog-rhythm-consumer-check)`。测试固化 LIVE_MISREPORT_FIXTURE 断言 RED。

**AC7 —— 既有测试全绿 + scoped 门绿**：`bash scripts/test.sh --for-task gap-ac76-cap-counts-subagents-not-worktrees --allow-thin` → **216 tests pass / 0 fail**；scoped static checks 全 PASS（含新 `cap-counts-subagents-check`）；`--static-checks-doc` 全绿（tick-core-drift 为既有 --no-block 非阻塞报告）。ts-typecheck 闸 `fan-in-ts-typecheck-gate.ts` → **typecheck GREEN — ADMITTED**（Touches 覆盖新增 .ts 1 个）。delivery-inventory snapshot 已随新增脚本 regenerated（`verify-delivery-surface.ts --write-inventory`，scripts disk=244）。

**C17 建议（orchestration/ 外层独占，只给建议不落盘）**：
1. `orchestration/orchestrator-tick-core.md` A18：`slot-refill.ts --root … --cap 5 --json`（bare）现会落到已退役的 telemetry-slot-status fallback。建议改为：把 in-flight 从 inner 任务 subagent 直接读（判据2：`<session>/subagents/agent-*.jsonl` 近 N 分钟写入数，用 cap-counts-subagents-check.ts --session-dir），或显式传 `--in-flight`；报数带计法（`在飞 subagent=M`；worktree 若同时给必标明是另一个量，判据4）。A21 的 `git worktree list` 是【活性】直接量（非在飞），若用于在飞须改读 subagent。
2. `orchestration/fast-mode-tick-core.md` A12：`--in-flight <本会话在飞集合>` 已是 subagent set（正确方向）。建议：用判据2 第三方读法交叉验证该集合（agent-*.jsonl 近 N 分钟写入数），并在 tick-log 报 `在飞 subagent=M` 带计法；`--closed-but-live`/telemetry 派生仅作派发留痕，不作在飞判据。
3. `orchestration/manager-tick-core.md` A3：`git worktree list` 逐条判在飞（代理量）退役。建议：在飞一律读 inner 会话 `subagents/agent-*.jsonl` 近 N 分钟写入数（判据2），任务状态只走 `tasks/*.md status`（09:1xZ 裁定）；worktree 计数若给必标为另一个量。
