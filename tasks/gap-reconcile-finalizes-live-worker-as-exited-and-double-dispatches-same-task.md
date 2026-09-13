---
id: gap-reconcile-finalizes-live-worker-as-exited-and-double-dispatches-same-task
title: reconcile 不核实 /proc 就把在飞 worker 判为已退出 —— 写假失败记录 + 同任务双派，两个 worker 共用一个 git 检出
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`computeOrphanFinalizedOutcome`（`plugin/scripts/worker-driver.ts:2497`，failure_reason 字符串在 `:2509`）**无条件**把一条终态 outcome 写成：

```
orphaned worker finalized by reconcile: driver restarted mid-flight and
worker pid <N> already exited (or was recycled) before a new instance could adopt it
```

「already exited」是**断言，不是测量**——该函数只接收 `workerPid` 数值，不做任何存活探测。

**实测证否（2026-09-13，第三方项目 quay-fleet，第一手 /proc 读数）**：
- 记录写于 `11:52:33`，点名 `worker pid 3653433 already exited`
- 约 11:55 读 `/proc/3653433`：**进程还活着**，`etime=163s`、累计 CPU `23s`、state=S
- 同一时刻 `/proc/3688006` 也活着——driver 在判定前一个「已死」后**又派了第二个**，两个 worker 的提示逐字相同（都是 `create an isolated git worktree for fleet-agent-sessions-screen-endpoint`）
- `worker-dispatch.json` 的 `workerPid` 只记 `3688006` ⇒ 3653433 成为**无人追踪但仍在写盘**的进程

**后果一：两个 Claude worker 共用一个 git 检出。** 该任务只有一份 worktree `/home/yale/work/quay-fleet-worktrees/fleet-agent-sessions-screen-endpoint`，其 `git status` 当时为 `M packages/agent-core/src/fleet-agent.mjs` + `?? test/agent-screen-endpoint.test.mjs`，`.git/worktrees/<task>/index` 的 mtime 是 `11:53:14`——**晚于两个 worker 的启动时刻**，即确有写入在进行。git 索引是共享可变状态，两个进程交替 `git add`/`commit` 会互相吞改动。

**后果二：这条假记录还要计进 needs-human 上限。** 该 outcome 的 `wall_clock_ms=55217`（<60000）⇒ 命中 `isQuickDeath`（`:2168`）⇒ 连续计数 +1。同任务此前已因账号限流吃掉 3 次（见 `gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human`），本条把它又往终态推近一步。

**关键点：能区分的原语【本仓库已经有】，只是这条路径没用。**
- `enumerateLiveWorkerCmdlines(procDir)` — `:540`
- `hasLiveWorkerForTask(taskId, cmdlines)` — `:568`
- `findLiveWorkerPid(taskId, procDir)` — `:576`，其注释逐字写着「读不到 /proc 也 null——硬规则 3b：读不懂 ≠ 无存活」

⇒ 缺陷不是「没有能力判活」，而是**一条已经具备判活能力的代码路径选择了直接断言**。这正是硬规则 4（结构上不可能取假的量不是测量）与 3b（读不懂不得与合格同形）的复合违反：`exit_code: null` 那一行注释自称「诚实记 null，⛔ 不伪造」，而同一个对象里的 `failure_reason` 恰恰伪造了一个它没有测量的事实。

**触发时机与发生率（硬规则 12，已查历史）**：`.quay/worker-driver-supervisor.log` 显示该 driver 在 **2.3 小时内重启 5 次**（09:34:01 / 10:22:01 / 10:42:57 / 10:55:11 / 11:52:27），每次日志行都是同一句 `supervisor: source changed (mtime=… > driver_start=…); restarting driver`。重启成因是 driver 直接加载 quay 的 `plugin/scripts/*.ts` 源码 ⇒ **quay 每落一个 commit，第三方项目的 driver 就重启一次**，每次重启都是一次本缺陷的触发机会。本次实测 5 次重启中至少 1 次产生了本缺陷（11:52:32 起 driver，11:52:33 写该记录，相隔 1 秒）。

⚠️ **未经检验的部分，⛔ 不得当作结论采纳**：已 done 的 `gap-worker-driver-cold-start-inflight-blind` 声称冷启动枚举是「只读探测、非猜测」，且手工 `quay driver restart` 不会重派仍存活的 worker。本次是 **supervisor 因源码变更触发的重启**，与手工 restart 是否走同一条冷启动路径**我没有做对照实验**。实现者必须先用一个能区分的对照确定：①该路径是否调用了冷启动枚举；②若调用了，为何 3653433 未被命中（cmdline 匹配失败？时序竞态——driver 启动 1 秒内就 reconcile？）。⛔ 在做出该对照之前不得改代码。

**查重记录（立案前，`task_list search`，全部经预取真样本核验非零可命中）**：`computeOrphanFinalizedOutcome` 0 条 / `orphaned worker finalized by reconcile` 0 条 / `findLiveWorkerPid` 0 条 / `双派` 0 条 / `already exited` 0 条 / `orphan`（status=todo）0 条。**零计数的配套动作（硬规则 2 镜像半边）**：同一 `search` 谓词对已知为真的样本 `isQuickDeath` 返回 **1** 条（即下面的关联任务）⇒ 谓词可命中，零计数是真零而非仪器故障。**关联但不重复的两条**：`gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human`（todo，治「快速死亡共用一个桶」，与本条共用同一受害任务但根因不同）、`gap-worker-driver-cold-start-inflight-blind`（done，治冷启动派发排除集，本条是它在 **finalize 写侧** 的未覆盖面 + 一条 supervisor-restart 路径的未验证残差）。

## Plan

1. 先做上面那个对照，确定 supervisor-restart 路径与手工 restart 路径的差异（一条命令级别的证据即可，不需要可控复现）。
2. `computeOrphanFinalizedOutcome` 不再无条件断言「已退出」：调用已有的 `findLiveWorkerPid` / `enumerateLiveWorkerCmdlines` 实测该 pid。
3. 三个取值必须互不相同（硬规则 3）：`pid 确认已退出` / `pid 仍存活`（⛔ 此时不得 finalize，应 adopt 或等待）/ `/proc 读不到，无法判定`（⛔ 不得与前两者任一同形）。
4. 判为「仍存活」时不得再派第二个 worker 到同一 task。
5. 「无法判定」与「确认已退出」在计入 `isQuickDeath` 连续计数上必须可区分——⛔ 一个没测量出来的死亡不该烧重试预算。

## Acceptance Criteria

- [ ] AC1 给 `computeOrphanFinalizedOutcome` 一个**当前存活**的 pid，它不得产出含 "already exited" 的 failure_reason；给一个**确已退出**的 pid，则产出该措辞。（双向对照，两个输入必须给出不同输出）
- [ ] AC2 `/proc` 不可读（注入一个空的 procDir）时，产出的取值与上面两者**都不相同**，且不含 "already exited"。
- [ ] AC3 同一 taskId 已有存活 worker 时，派发路径不得再起第二个 worker：构造该状态并断言派发计数为 0；把存活 worker 移除后同一构造断言派发计数为 1。
- [ ] AC4 判为「无法判定」的 finalize 不计入 `recordQuickDeathBackoff` 的连续计数：连续 N 次（N > backoffMaxRetries）「无法判定」后任务 status 仍不是 needs-human；换成 N 次「确认已退出」则是。
- [ ] AC5 **读生产载体**（硬规则 4 推论三）：实现落地之后的时间窗内，`.quay/worker-outcome.jsonl` 中任一 `failure_reason` 含 "orphaned worker finalized by reconcile" 的记录，其 pid 在记录时刻确已不存在——判据形式为「该类记录数 ≥1 且其中假阳性 =0」。若窗口内自然样本为 0，须在任务体写明「未取到自然样本」，⛔ 不得用 fixture 顶替而不标注。

## Definition of Done

- 五条 AC 全部满足，且 Plan 第 1 步的对照结论写进任务体（含所用命令与读数）。
- ⛔ 不得把「无法判定」与「确认已退出」合并成同一取值。
- ⛔ 不得删除或弱化 `exit_code: null` 的既有诚实处理（`:2504` 附近，那一条是对的）。
- ⛔ 不得新增对 worker 自述的采信——存活判定只走 `/proc`（外部可核直接量，硬规则 4b）。
- 任务体须保留本条的第一手读数：3653433 的 `/proc` 存活证据（etime/CPU）、双 worker 的逐字相同提示、worktree 的 `git status` 与 index mtime、以及 supervisor log 那 5 行重启记录。

## Touches

- plugin/scripts/worker-driver.ts（`computeOrphanFinalizedOutcome` 存活探测 + 三取值枚举 + 派发侧存活短路 + quick-death 计数分流）
- plugin/test/worker-driver-fan-in.test.mjs（AC1–AC4 的对照断言落点）
- tasks/gap-reconcile-finalizes-live-worker-as-exited-and-double-dispatches-same-task.md（自身）

**测试文件选择是实测的，不是猜的**：`recordQuickDeathBackoff|isQuickDeath|backoffDelayMs` 在 `plugin/test/worker-driver-fan-in.test.mjs` 命中 **25** 条（真断言），而 `plugin/test/worker-driver.test.mjs` 与 `plugin/test/worker-driver-resident.test.mjs` 各只有 **3** 条且全在 import 块 ⇒ 退避/快速死亡的断言在 fan-in 那一份。

**⚠️ 实现方落笔前必须再 grep 一次（本条只测了退避符号，没测 orphan-finalize 符号）**：`grep -rn "computeOrphanFinalizedOutcome" plugin/test/` —— 若 orphan-finalize 的既有断言落在另一份文件，把那一份一并加进 Touches（⛔ 不要照抄本清单而让它成为未声明改动 ⇒ anti-drift 红）。共享 harness `plugin/test/helpers/worker-driver-harness.mjs` 若被改动须一并声明。
