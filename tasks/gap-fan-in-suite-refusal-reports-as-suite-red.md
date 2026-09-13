---
id: gap-fan-in-suite-refusal-reports-as-suite-red
title: fan-in suite 拒绝启动被报成「suite red」——runner 诊断全走 stderr 而 suite log 只 tee
  stdout ⇒ 0 字节日志 + 裸「suite red」，「没跑」与「跑了且失败」同形
status: done
labels:
  - gap
  - defect
  - instrumentation
parent: null
children: []
extra:
  schema: execution
---
## Finding

**实测（2026-09-13T08:14:57.865Z，任务 `gap-suite-wallclock-budgets-literals-depend-on-host-capacity` 的机械 fan-in）**：`suite-end` 记 `exit:1 wall_ms:509636 reason:"suite red"`，而该轮的 suite log `.quay/fan-in-suite-gap-suite-wallclock-budgets-literals-depend-on-host-capacity~wk-prod-1789139008~1789284992760-e1ccf.log` 为 **0 字节**，且 `.quay/verification-round.jsonl` **无该轮记录**。受害任务自身无过错，却被烧掉一整轮 fan-in 并计一次重试上限。

**机制（三层，全部有 file:line 证据）**：

1. bash `slot-holder`（`plugin/scripts/suite-driver.ts:77-101`）取到单飞槽后 `exec` runner；
2. runner 读**共享** `<root>/.quay/full-suite-state.json`，见 `state:"running"` 且 pid 存活（前一个 runner 尚未写 terminal）⇒ 命中 spawn 层单飞拒绝分支（`full-suite-runner.ts`，拒绝检查段）⇒ `return 1`，消息**只写 stderr**；
3. `plugin/scripts/suite-driver.ts` 只把子进程 **stdout** tee 进 suite log（stderr 只当活性 tick，内容丢弃）——而生产 runner **完全不用 stdout**（含终判在内的一切诊断都在 stderr）⇒ 日志恒 0 字节。

**判别量（结构性，不是推断）**：suite log 由 runner 以 `flags:"w"` 打开，位于**所有拒绝分支之后** ⇒ **0 字节日志 == "runner 在开流点之前就返回了"**。

**竞态窗口（实测）**：前一个 runner 释放单飞槽于 ~08:14:50.5（该轮 `lock_hold_ms=657257`），但其进程活到 ~08:14:58.8（`durationMs=665569）⇒ 存在约 8 秒的「槽已释放、状态文件仍说 in-flight」窗口；排队中的下一个 fan-in 恰好落进该窗口即被拒。`isRunnerInFlight` 判定 = 非 terminal ∧ pid 存活（`plugin/scripts/suite-state-trigger.ts:959-964`）——它读的是**代理量**（状态文件），而调用方**已经持有直接量**（单飞槽 flock）。

**下游形态**：`worker-driver.ts` 的 `extractFirstFailureLine("")` 返回空 ⇒ reason 回退为裸 `"suite red"`，与「真跑且真失败」的措辞**无法区分**（硬规则 3b：读不懂/没跑，被记成与「跑了且失败」同形）。

**零控制排除**：资源闸 WAIT 路径被排除——同期 gds 启动器自己的 runner 在 07:50:07 / 08:03:53 / 08:15:11 均记 `resource gate says GO`；reaper 击杀被排除——被信号杀死会是 `exitCode:null` + `signalCode`，而非观测到的 `exit:1`。

**影响面（同宿主 30 分钟内）**：4 个 0 字节 `fan-in-suite-*.log`（07:44 / 08:02 / 08:06 / 08:16），分属 4 个不同任务，全部被记成 `step=suite: suite red`。

**触发条件（现场事实，⛔ 不是本条的修法）**：`/tmp/gds-ac3-rounds.sh`（detached，ppid 1，仓库内无 `gds-ac3` 串）为任务 `gap-driver-start-false-confirms-unsettled-driver` 的 AC3 连跑 3 轮**全量** suite（809s / 665s），其 `--state-dir` 指向**同一个** `/home/yale/work/quay/.quay`，与 fan-in 的 in-flight 闸读同一份状态文件；`.git/full-suite.lock.concurrency` = 1（全仓单槽）。⛔ 不要 kill 该脚本——它不属于本仓库机制，本条要修的是拒绝路径的可观测性与归因。

**现有覆盖（均不覆盖本形态）**：`gap-runner-spawn-single-flight`(done) 引入了该拒绝闸但未对其可观测性提任何要求；`gap-fan-in-suite-red-reason-carries-split-or-commit-title`(done) 修的是「从日志取错行」，而本条日志为空；`gap-goal-closure-freezes-failing-ac-outside-reverify-scope`(done) 记录的 0 字节是 **15 分钟静默看门狗 SIGKILL**（`exit:null` + `hung`）——本条是**独立子形态**：取到槽 + runner 启动 + `exit:1` 拒绝。另有两个零覆盖缺口：①fan-in suite log 只捕获 stdout，runner 全部诊断不可见；②拒绝路径不写状态文件，被拒轮与「从未跑过」不可分。

## Plan

**修法（⛔ 只改可观测性与归因，不改拒绝语义本身）**：在 producer（runner）与 consumer（worker-driver）两侧各加一个**结构性事实**，使「本轮跑没跑」不再是代理量推断。

1. **producer（`full-suite-runner.ts`）**：新增两个溯源标记前缀常量（唯一真相源，导出供 reader import，⛔ 不各写一份字面量）：
   - `SUITE-RUN-START` —— 在 suite log 流建立后**立刻**写入（即 `flags:"w"` 开流点之后）⇒ 本轮确实进了执行段；
   - `SUITE-NOT-RUN` —— 每条「未跑就返回」的分支写一行，含 `branch=<机器可读分支名>` 与 `reason`。
   覆盖范围（硬规则 5b：修一个实例 ⇒ 在同一载体上 grep 同类点并全部覆盖）：单飞拒绝 / 资源闸 WAIT / 参数非法（3 处）/ one-shot 供给失败 / 开流前 crash / 开流前 signal-abort。前三个原本位于 `logFile` 解析点**之前** ⇒ 把那三行解析**纯移**到 `mainRoot` 之后（只依赖 `mainRoot` + argv，与后续 one-shot 的 `root` 重赋值无关）。
   ⇒ **0 字节从此有确定含义**（「runner 连两个写入点都没到」= 进程没起来/启动即死），⛔ 不再是「拒绝」的代理量。
2. **consumer（`worker-driver.ts`）**：`extractSuiteNotRunLine`（与 writer import 同一常量前缀）+ 把标记行列入 `isNoiseLine`（拒绝**不是**一条测试失败，⛔ 不得被 `extractFirstFailureLine` 当失败摘要）。suite 步失败时**先判「跑没跑」再判「为什么红」**：被拒轮 `reason` = `suite NOT run (refused) — <标记行>`，`suite-end` 的 trace 同步自报（Finding 实证的形态正是那条 `reason:"suite red"`），且被拒轮**不写**第三方 path 的 red 轮次（那会记成「跑了且红」）。

**⛔ 明确不改**：`isRunnerInFlight` 判定语义（`gap-runner-spawn-single-flight` 的产物）；单飞槽数与 `.concurrency`。
**⛔ 一个被考虑后否决的方案**：在 `suite-driver.ts` 无条件把 stderr 也 tee 进 suite log。它能让**全部** runner 诊断可见，但会改变**每一轮**的失败行提取（runner 的终判行含 `exit=<n>`，命中 `isFailureLine` 的松散分支），落地风险覆盖整套 suite；且 AC1 只要求「未跑就返回」的分支可见，那条已由 producer 侧标记确定性地满足。故 `suite-driver.ts` 保留在 Touches 里（Finding 指名的机制层、后续若要做全量 stderr tee 的落点）但**本轮未改**。

## AC

- [x] AC1（可取假）——runner 的每条「未跑就返回」分支（原 `:1842-1851` 单飞拒绝 / `:1856-1870` 资源闸 WAIT；实现中按硬规则 5b 扩展到全部 suite 前返回点）在 suite log 中留下**可读的一行**（含分支名与原因）。判据：干跑一次拒绝路径 ⇒ suite log 非空且含该分支标记；负控制：闸 GO 且无在飞 runner 时该行**不出现**。〔Evidence §1〕
- [x] AC2（三态可分）——被拒绝的一轮在下游与「跑了且绿」/「跑了且红」**可区分**：`mechanical_fan_in.reason`（或等价 verdict 字段）不得再出现裸 `"suite red"`，须指名「未运行（拒绝）+ 哪条分支」。〔Evidence §2，含红控制〕
- [x] AC3（结构量替代代理量）——消除「0 字节日志」的歧义：suite log 写入**开始标记**（或记录一条 refused 事件），使「0 字节 ⇒ runner 在开流点前返回」成为机械可判的事实。判据：附一次干跑，证明拒绝轮与非拒绝轮该标记可取假。〔Evidence §3〕
- [ ] AC4（生产载体验证·读产物）——落地后，取新产生的 `fan-in-suite-*.log` 中 0 字节者，其 fan-in trace 的 `reason` **不再是**裸 `"suite red"`。⚠️ 记 **not-evaluated**：本实现尚未在产线跑过（窗口全部早于落地），窗口读数见 Evidence §4——⛔ 不用「窗口内无新 0 字节日志」宣告修好。（待外部）

## DoD

- 拒绝路径的每一分支在 suite log 里留可读证据；被拒轮在下游不再与真红同形。
- ⛔ 本条**不改** `isRunnerInFlight` 的判定语义本身（那是 `gap-runner-spawn-single-flight` 的产物），只修**拒绝的可观测性与归因**。
- ⛔ 本条**不动**单飞槽数与 `.concurrency`（泳道/并发旋钮属其它任务范围）。

## Evidence

落地物：`plugin/scripts/full-suite-runner.ts`（标记常量 + `recordSuiteNotRun`/`appendSuiteLogMarker` + 9 个调用点 + RUN-START 写入）、`plugin/scripts/worker-driver.ts`（`extractSuiteNotRunLine` + `isNoiseLine` + 归因顺序 + `suite-end.refused`）、`plugin/test/suite-state-trigger.test.mjs`（同类代理量修正，见 §5）。分支 `task/gap-fan-in-suite-refusal-reports-as-suite-red`，提交 `bb0c15ac6` + `441eec2ae`。

**§1 AC1 干跑（真实 runner 进程，非 fixture）**
- 单飞拒绝：写 `<T>/.quay/full-suite-state.json` = `{state:"running",pid:<live>}`，跑
  `node --experimental-strip-types plugin/scripts/full-suite-runner.ts --root <T> --state-dir <T>/.quay --log-file <T>/.quay/fan-in-suite-probe~run~1.log`
  ⇒ exit 1，日志 **230 字节**（⛔ 非 0），内容含
  `SUITE-NOT-RUN branch=single-flight-refusal … reason="another runner is already in flight (state=running, pid=…)…" — no test was executed by this round`。
- 资源闸 WAIT：`QUAY_TEST_SKIP_RESOURCE_GATE=0 RESOURCE_GATE_TEST_CPU_AVG10=84.77 RESOURCE_GATE_TEST_LOAD_OVERRIDE=1` ⇒ exit 1，日志 **278 字节**，含 `branch=resource-gate-wait reason="resource gate says WAIT — => WAIT: CPU 饥饿…"`。标记行有界（detail 压平 + 截断 300 字符——首版嵌整块 gate 输出成 4.6KB 单行，已修）。
- 负控制：闸 GO（`CPU_AVG10=10`）⇒ exit 0、suite 真被 spawn、日志里 `grep -c SUITE-NOT-RUN` = **0**。
- 测试：`plugin/test/full-suite-runner.test.mjs` 新增 4 个（含负控制），整文件 **81/81 绿**。
- **红控制（prefix code swap）**：把 `appendSuiteLogMarker` 体置空（pre-fix 行为）⇒ 3 个标记存在性测试**转红**、负控制仍绿（证明这组测试不空转）；换回后 4/4 绿。

**§2 AC2 归因（含红控制）**
- 测试：`plugin/test/worker-driver-fan-in.test.mjs` 新增 3 个。忠实模拟拒绝（suite 命令写标记行后 exit 1、一条测试都没跑）⇒ `r.reason` = `suite NOT run (refused) — [full-suite-runner] SUITE-NOT-RUN branch=single-flight-refusal …`，且过程日志 `suite-end` 行 `reason` 不再为裸 `"suite red"`、带 `refused:true`；负控制（真跑且真红、无标记）⇒ reason 仍为 `AssertionError …`，⛔ 不冒称「未运行」。
- **红控制**：把 `refusalLine = extractSuiteNotRunLine(...)` 改为 `null`（pre-fix 行为）⇒ AC2 测试转红，`actual: 'suite red'`，正是 Finding 描述的病；负控制仍绿。还原后 3/3 绿。
- 跨模块一致性：`import` 检查 reader 常量与 writer 常量同值，且两个标记都被 `extractFirstFailureLine` 与 `runner-red-parse` 的 `isFailureLine` 判为**非**失败行（前者返回 `""`，后者 `false`）——⛔ 标记不会伪装成一条测试失败。

**§3 AC3 两态可取假（同一轮同时取证）**
- 非拒绝轮（真跑、绿）：日志含 `SUITE-RUN-START ts=… runId=… scope=main pid=… `，**不含** `SUITE-NOT-RUN`。
- 拒绝轮：日志含 `SUITE-NOT-RUN`，**不含** `SUITE-RUN-START`（它没进执行段——这正是旧「0 字节」的歧义所在）。
- 两者由测试 `AC3 — 两个标记在两态间可取假` 在同一测试内断言。

**§4 AC4 生产载体窗口读数（not-evaluated 的依据）**
窗口 = 落地前，全部读数取自 `/home/yale/work/quay/.quay` 的真实产物（2026-09-13 本会话实测）：
- `fan-in-suite-*.log` 共 **135** 个，0 字节 **2** 个（均落在窗口内：`…~1789283949198-b46ce0.log` 07:44:14、`…~1789284439473-404e8f.log` 08:02:11），二者均早于本实现落地 ⇒ **不构成「落地后新产生的 0 字节日志」**。
- 窗口（2026-09-13）fan-in suite 尝试 = **11** 次，其中 0 字节 = **2** 次。
- `.quay/fan-in-step-trace.jsonl`：失败 `suite-end` 行全时 **204** 条，其中 `reason` 为裸 `"suite red"` **194** 条（95%）；窗口内失败 **12** 条，裸 `"suite red"` **11** 条（Finding 引用的 `gap-suite-wallclock-budgets-literals-depend-on-host-capacity` 08:14:57.865Z 那一条在列，exit 1、裸 `"suite red"`）。
⇒ 本实现**尚未在产线跑过**，「落地后新 0 字节日志的 reason」这个量在本窗口内**结构上不存在**（硬规则 4 推论三：只能被注入数据满足的判据不是测量）⇒ 记 **not-evaluated（待外部）**，并把上述窗口 runs 数写明，⛔ 不以「窗口内无新 0 字节日志」宣告修好。

**§5 同类点（硬规则 5b）——`plugin/test/suite-state-trigger.test.mjs`**
本改动让 WAIT / 单飞拒绝轮也留下一个**非空的** `<stateDir>/full-suite.log`。全仓 grep「用日志文件存在性当『suite 跑没跑』的代理」命中一处：`suite-state-trigger.test.mjs` 的 AC4 断言 `!existsSync(<root>/.quay/full-suite.log)`（判词「the suite was NEVER spawned on WAIT」）——正是硬规则 4b 的代理量。改为**直接量**：断言 suite 命令**自己的输出**从未落进日志（`--command` 的 echo 原文）。红控制：同参数但闸 GO ⇒ 该字符串确实出现在日志里（`grep -c` = **1**）⇒ 新断言可取假、不空转。该文件整文件 **53/53 绿**。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/scripts/worker-driver.ts
- plugin/test/full-suite-runner.test.mjs
- plugin/test/worker-driver-fan-in.test.mjs
- plugin/test/suite-state-trigger.test.mjs
- plugin/scripts/suite-driver.ts
- plugin/test/suite-driver.test.mjs
- tasks/gap-fan-in-suite-refusal-reports-as-suite-red.md
