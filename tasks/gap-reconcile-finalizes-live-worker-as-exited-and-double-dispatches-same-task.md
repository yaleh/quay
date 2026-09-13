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

## Plan 第 1 步的对照结论（2026-09-13 实测，含命令与读数）

**答①：supervisor-restart 路径【确实】每趟都跑冷启动枚举。** 循环体里 `step = "cold-start-inflight"; coldInflight = await enumerateColdStartInflightAsync(rootDir);` 是无条件步（`worker-driver.ts` 常驻环），没有任何「本次是重启」的分支。⇒ 与手工 restart **走同一条冷启动路径**，Proposal 里那个「未验证残差」不成立。

**答②：3653433 未被命中【不是时序竞态，是 cmdline 匹配失败】——根因是存活探测写死了字面量。**

决定性对照（真 `launchArgv` 造两臂，只差角色名；两臂输出相反 ⇒ 是证明不是相关，硬规则 4 推论四）：

```
$ node --experimental-strip-types -e '
  import { launchArgv } from "./plugin/scripts/driver-runtime.ts";
  import { hasLiveWorkerForTask, WORKER_PROCESS_NAME } from "./plugin/scripts/worker-driver.ts";
  const task = "fleet-agent-sessions-screen-endpoint";
  const prompt = "create an isolated git worktree for " + task + " ...";
  const fleetCmd = launchArgv("task-worker", prompt, "/home/yale/work/quay-fleet").join(" ");
  const quayCmd  = launchArgv("task-worker", prompt, "/home/yale/work/quay").join(" ");
  console.log(WORKER_PROCESS_NAME, hasLiveWorkerForTask(task, [fleetCmd]), hasLiveWorkerForTask(task, [quayCmd]));'
quay-task-worker false true
```

读到的两臂 argv（逐字，只差 `-n` 名与 launcher）：
- ARM1（quay-fleet）：`claude --settings {...} --exclude-dynamic-system-prompt-sections --prompt-suggestions false -n fleet-task-worker -p create an isolated git worktree for fleet-agent-sessions-screen-endpoint ...`
- ARM2（quay）：`claude-fjdac --settings {...} --exclude-dynamic-system-prompt-sections --prompt-suggestions false --model ... -n quay-task-worker -p create an isolated git worktree for ...`

配置面对照：
```
quay/.quay/profiles.yml        roles.task-worker.name → quay-task-worker
quay-fleet/.quay/profiles.yml  roles.task-worker.name → fleet-task-worker
```

⇒ `WORKER_PROCESS_NAME = "quay-task-worker"`（`worker-driver.ts:281`）是 **quay 自己**的命名；第三方项目按 quay-init 的注释自行改名（quay-fleet 就叫 `fleet-task-worker`）。而全部存活探测（`enumerateLiveWorkerCmdlines` / `hasLiveWorkerForTask` / `findLiveWorkerPid` / `classifyOrphanDispatch` / `cleanupOrphanWorktree` 门① / `reclaimSupersededWorktrees` 门①）都写死该字面量 ⇒ **在 quay-fleet 上对每一个真实 worker 恒 false**，三个后果同时发生：
1. `classifyOrphanDispatch` 恒判 finalize ⇒ 写那条假记录（本条缺陷）；
2. `coldInflight` 恒空 ⇒ 该 task 不被排除 ⇒ **同任务双派**（两个 worker 共用一份检出）；
3. `cleanupOrphanWorktree` 的存活闸同样失效 ⇒ 假记录里 `worktree_cleanup_skipped_live: false` + `worktree_cleaned: true` = **在飞 worker 的 worktree 被删掉了**（比 Proposal 记的「共用一份检出」更重）。

**对 Proposal「后果二」的实测更正（诚实记账）**：`recordQuickDeathBackoff` 在本文件里只有**一个**非测试调用点 `onWorkerFinished`；孤儿 finalize 的 outcome 经 `reconcileOrphanDispatches` 只写盘 + 打 json 事件，**不进 `results`、不经 `onWorkerFinished`** ⇒ 那条假记录**当时并没有**烧掉 needs-human 预算。Proposal 的「后果二」是按「failed + wall<60s ⇒ isQuickDeath」**推断**出来的，未做对照（硬规则 4 推论四：能解释现象的说法不是被检验的结论）。AC4 因此按【判据】实现（函数级三值分流 + 在唯一记账点接线），并如实记下它当前不是一条活跃生产路径（见 DoD 与 AC4 注）。

## Acceptance Criteria

- [x] AC1 给 `computeOrphanFinalizedOutcome` 一个**当前存活**的 pid，它不得产出含 "already exited" 的 failure_reason；给一个**确已退出**的 pid，则产出该措辞。（双向对照，两个输入必须给出不同输出）—— `worker-driver.test.mjs`「AC1 (双向对照)」：活 witness（真 spawn）vs 真退出 witness（真等 /proc 条目消失），断言 `orphan_pid_liveness` 分别 `alive`/`exited`、两臂 reason **不同**。红控制已做：pre-fix 源码对**刚 spawn、确实活着**的 pid 仍写出 `already exited`（缺陷逐字复现）。
- [x] AC2 `/proc` 不可读（注入一个空的 procDir）时，产出的取值与上面两者**都不相同**，且不含 "already exited"。—— `probePidLiveness` 三值；空 procDir（无任何 pid 条目）⇒ `unknown`；目录不存在 ⇒ `unknown`；真 procfs 且 pid 不在 ⇒ `exited`。三条 reason 两两不同形。
- [x] AC3 同一 taskId 已有存活 worker 时，派发路径不得再起第二个 worker：构造该状态并断言派发计数为 0；把存活 worker 移除后同一构造断言派发计数为 1。—— ①端到端（真 driver）：`worker-driver-fan-in.test.mjs`「AC5 (生产载体, 双臂)」臂② 断言 `worker-spawned` 事件对同一 task **不存在**（计数 0），且 reconcile 走 **adopt** 而非判死；②既有两臂对照测试（cold-start AC1「surviving worker ⇒ 不重派」+ 其对照「无活 worker ⇒ 重派」）在本次修复后仍绿；③承重对照「AC3 (名字解析)」：同一 argv 只改角色名 ⇒ `enumerateColdStartInflight` 由空集变含该 task（移除 witness ⇒ 空集 = 可派）。**修复前**在第三方项目里 ②③ 恒假（排除集恒空）。
- [x] AC4 判为「无法判定」的 finalize 不计入 `recordQuickDeathBackoff` 的连续计数：连续 N 次（N > backoffMaxRetries）「无法判定」后任务 status 仍不是 needs-human；换成 N 次「确认已退出」则是。—— `worker-driver-fan-in.test.mjs`「AC4 (三值分流)」：`unknown`×5 ⇒ `newlyNeedsHuman` 恒 false 且 `counts`/`backoffUntil` **不动**；`exited`×5 ⇒ 到 `maxRetries=3` 即 `newlyNeedsHuman=true`；两臂计数结果**不同**。另断言 `unknown` 不打断**已测量**的连续死亡序列（⛔ 与「非快速死亡 ⇒ 复位」刻意不同形）。注：如 Plan 第 1 步结论所述，孤儿 finalize 的 outcome 目前不经 `onWorkerFinished` ⇒ 本条是**判据 + 唯一记账点的接线**，不是当前活跃的生产路径。
- [x] AC5 **读生产载体**（硬规则 4 推论三）：实现落地之后的时间窗内，`.quay/worker-outcome.jsonl` 中任一 `failure_reason` 含 "orphaned worker finalized by reconcile" 的记录，其 pid 在记录时刻确已不存在——判据形式为「该类记录数 ≥1 且其中假阳性 =0」。若窗口内自然样本为 0，须在任务体写明「未取到自然样本」，⛔ 不得用 fixture 顶替而不标注。—— **窗口内自然样本 = 0，未取到自然样本**（见下节）。补偿性证据（**临时 root 的真实 resident driver 跑，已明确标注非自然样本**）：「AC5 (生产载体, 双臂)」断言真载体里该类记录数 ≥1 且**每条都带 `orphan_pid_liveness`**、假阳性（`liveness !== "exited"`）=0，且活 worker 那臂零记录。

## AC5 窗口说明（⛔ 未取到自然样本，不用 fixture 顶替）

实现落地时点 = 本 worktree 提交 `1d09696c5`。该提交**尚未进 develop** ⇒ 没有任何生产 driver 能在窗口内用它产出记录。窗口内实测读数（两份载体，按 `failure_reason` 含 `orphaned worker finalized by reconcile` 过滤）：

```
/home/yale/work/quay/.quay/worker-outcome.jsonl        → 24 条（2026-09-06T17:51 … 2026-09-11T07:09）
/home/yale/work/quay-fleet/.quay/worker-outcome.jsonl  →  1 条（2026-09-13T11:52:33.856Z，pid 3653433，wall 55217）
其中带 orphan_pid_liveness 字段（本修复后才可能写入的字段）的：0 条
```

**⇒ 窗口内自然样本 = 0：未取到自然样本。** 两条旁证（不是替代品）：①quay 自己 6 天内就产生 **24** 条这类记录 ⇒ 该代码路径是活跃的、修复一进 develop 就会很快有自然样本；②quay-fleet 那条 `pid 3653433` 是**已证实的假阳性**（Proposal 的 /proc 读数「还活着」+ 本次 pre-fix 红控制逐字复现）。

## Definition of Done

- 五条 AC 全部满足，且 Plan 第 1 步的对照结论写进任务体（含所用命令与读数）。✅ 见「Plan 第 1 步的对照结论」节
- ⛔ 不得把「无法判定」与「确认已退出」合并成同一取值。✅ `PidLiveness = "alive" | "exited" | "unknown"` 三值，三条 reason 逐字不同；空 procDir 专测 `unknown`。
- ⛔ 不得删除或弱化 `exit_code: null` 的既有诚实处理（`:2504` 附近，那一条是对的）。✅ 未触碰 `exit_code: null`（三值枚举只改 `failure_reason` 的措辞与新增字段）。
- ⛔ 不得新增对 worker 自述的采信——存活判定只走 `/proc`（外部可核直接量，硬规则 4b）。✅ 存活判定全部走 `/proc`（新 `probePidLiveness` 读 `/proc/<pid>` 条目 + `cmdline`）；唯一从配置读的是**「worker 叫什么」**（`.quay/profiles.yml` roles.task-worker.name），不是「它是否活着」。
- 任务体须保留本条的第一手读数：3653433 的 `/proc` 存活证据（etime/CPU）、双 worker 的逐字相同提示、worktree 的 `git status` 与 index mtime、以及 supervisor log 那 5 行重启记录。✅ 全部保留在 Proposal 未改动。

## 实现与验证记录（2026-09-13）

**改动（`plugin/scripts/worker-driver.ts`）**
- 新增 `resolveWorkerProcessName(root)`：从 `.quay/profiles.yml` 的 `roles.task-worker.name` 解析 worker 进程名（解析失败回落 `WORKER_PROCESS_NAME`，⛔ 不抛——探测是观测，观测不得让驱动停摆）。
- 新增 `probePidLiveness(pid, procDir) → "alive" | "exited" | "unknown"`：`≥1 个 pid 条目`才承认「看得见进程表」⇒ 空目录/读不到一律 `unknown`，⛔ 不与 `exited` 同形（硬规则 3b）。僵尸（条目在、cmdline 空）算 `exited`（读到了，它就是空的 ⇒ 是测量）。
- `computeOrphanFinalizedOutcome` 先实测再写：三条互不同形的 reason + 机器可读字段 `orphan_pid_liveness`（⛔ 不让下游去正则抠措辞）。`exited` 保留原措辞（既有下游按它判读）。
- `finalizeOrphanDispatch` **存活闸**：`probePidLiveness === "alive"` ⇒ 拒绝（⛔ 不写终态 / ⛔ 不清 worktree / ⛔ 不清记录）。判据刻意用**与 worker 名无关**的存在性，而不是需要名字的 `classifyOrphanDispatch`——用一个需要名字的判据去兜「名字可能解析错」的底是空的（这条是本实现过程中自己抓到的第一个版本的漏洞，已改）。`unknown` 则写一条**不声称死亡**的记录释放 in-flight 影子，但⛔ 不动 worktree（读不到进程表时无法证明没人在里面写）。
- 名字解析穿透所有存活探测点（硬规则 5b：⛔ 不只修被报出来的那一处）：`enumerateLiveWorkerCmdlines` / `hasLiveWorkerForTask` / `findLiveWorkerPid` / `classifyOrphanDispatch` / `cleanupOrphanWorktree` / `enumerateColdStartInflight{,Async}` / `reclaimSupersededWorktrees`。
- `isQuickDeath` / `recordQuickDeathBackoff` 接受 `orphan_pid_liveness`：只有实测 `exited` 才算死亡；`unknown`/`alive` 既不计入也不复位（⛔ 与前两者任一同形；也不让交错注入 `unknown` 洗白真实 streak）。`onWorkerFinished` 的记账点接线传入该字段。

**验证**
- 新增 6 条断言（`worker-driver.test.mjs` 4 条 + `worker-driver-fan-in.test.mjs` 2 条），逐条对 AC。
- 红控制（`prefix-code-swap` 手法）：把 pre-fix 源码换回、保留新测试 ⇒ AC4 断言 `AssertionError: ⛔ 没测成的死亡不是死亡（actual true / expected false）`；pre-fix `computeOrphanFinalizedOutcome` 对刚 spawn 的活 pid 仍写 `already exited` ⇒ AC1/AC2 的承重断言逐字复现缺陷。换回后 `git diff --stat` = 183 insertions / 37 deletions。
- 三个 touched 测试文件全绿：`worker-driver.test.mjs` 96/96、`worker-driver-fan-in.test.mjs`（含新 AC4/AC5）全绿、`worker-driver-resident.test.mjs` 43/43。
- `worker-driver.ts` 直接 typecheck（`plugin/scripts/**` 不在 root tsconfig 的 include 内，故单建临时 tsconfig）零**新增**错误：6 条错误与基线逐条同址（改动前 3664/3672/3679/4525，改动后对应行号平移）。

**已知取舍（本条主动记下，⛔ 不藏）**：pid 被复用成一个长命进程时，存活闸会让该孤儿记录一直不被 finalize（残留、不破坏任何东西，等该 pid 消失即自愈）。取舍方向是「宁可留残留，⛔ 不判死活 worker」——反向代价是删掉在飞 worker 正在写的 worktree + 清掉记录 ⇒ 同任务双派（正是本缺陷）。

## Touches

- plugin/scripts/worker-driver.ts（`computeOrphanFinalizedOutcome` 存活探测 + 三取值枚举 + 存活闸 + 派发侧存活短路 + quick-death 计数分流 + worker 名解析穿透）
- plugin/test/worker-driver.test.mjs（orphan-finalize 既有断言所在文件；AC1/AC2/AC3/存活闸 的新断言落点）
- plugin/test/worker-driver-fan-in.test.mjs（quick-death/退避断言所在文件；AC4 三值分流 + AC5 生产载体双臂 e2e 落点）
- tasks/gap-reconcile-finalizes-live-worker-as-exited-and-double-dispatches-same-task.md（自身）

**测试文件选择是实测的，不是猜的**：`recordQuickDeathBackoff|isQuickDeath|backoffDelayMs` 在 `plugin/test/worker-driver-fan-in.test.mjs` 命中 **25** 条（真断言），而 `plugin/test/worker-driver.test.mjs` 与 `plugin/test/worker-driver-resident.test.mjs` 各只有 **3** 条且全在 import 块 ⇒ 退避/快速死亡的断言在 fan-in 那一份。

**⚠️ 实现方落笔前必须再 grep 一次（本条只测了退避符号，没测 orphan-finalize 符号）**：`grep -rn "computeOrphanFinalizedOutcome" plugin/test/` —— 若 orphan-finalize 的既有断言落在另一份文件，把那一份一并加进 Touches（⛔ 不要照抄本清单而让它成为未声明改动 ⇒ anti-drift 红）。共享 harness `plugin/test/helpers/worker-driver-harness.mjs` 若被改动须一并声明。

**实测结论（已按上述要求 grep）**：`computeOrphanFinalizedOutcome` / `classifyOrphanDispatch` / `orphanDispatchCandidates` / `finalizeOrphanDispatch` / `adoptOrphanWorker` / `readPidCmdline` 的既有断言落在 **`plugin/test/worker-driver.test.mjs`**（`:120-124` import、`:2401/:2433/:2450+` 断言），⛔ 不在 fan-in 那一份 ⇒ **已把 `plugin/test/worker-driver.test.mjs` 加进 Touches**（本清单原缺，照抄即 anti-drift 红）。共享 harness 未改动（新测试只消费其既有导出）。
