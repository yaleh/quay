---
id: gap-fan-in-suite-refusal-reports-as-suite-red
title: fan-in suite 拒绝启动被报成「suite red」——runner 诊断全走 stderr 而 suite log 只 tee
  stdout ⇒ 0 字节日志 + 裸「suite red」，「没跑」与「跑了且失败」同形
status: todo
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
2. runner 读**共享** `<root>/.quay/full-suite-state.json`，见 `state:"running"` 且 pid 存活（前一个 runner 尚未写 terminal）⇒ 命中 spawn 层单飞拒绝分支 `plugin/scripts/full-suite-runner.ts:1842-1851` ⇒ `return 1`，消息**只写 stderr**；
3. `plugin/scripts/suite-driver.ts:194` 只把子进程 **stdout** tee 进 suite log（`:195` 丢弃 stderr 内容，仅当活性 tick）——而生产 runner **完全不用 stdout**（含终判在内的一切诊断都在 stderr，`full-suite-runner.ts:3759-3761`）⇒ 日志恒 0 字节。

**判别量（结构性，不是推断）**：suite log 由 `full-suite-runner.ts:2556` 以 `flags:"w"` 打开，位于**所有拒绝分支之后** ⇒ **0 字节日志 == "runner 在 `:2556` 之前就返回了"**。

**竞态窗口（实测）**：前一个 runner 释放单飞槽于 ~08:14:50.5（该轮 `lock_hold_ms=657257`），但其进程活到 ~08:14:58.8（`durationMs=665569）⇒ 存在约 8 秒的「槽已释放、状态文件仍说 in-flight」窗口；排队中的下一个 fan-in 恰好落进该窗口即被拒。`isRunnerInFlight` 判定 = 非 terminal ∧ pid 存活（`plugin/scripts/suite-state-trigger.ts:959-964`）——它读的是**代理量**（状态文件），而调用方**已经持有直接量**（单飞槽 flock）。

**下游形态**：`worker-driver.ts` 的 `extractFirstFailureLine("")` 返回空 ⇒ reason 回退为裸 `"suite red"`，与「真跑且真失败」的措辞**无法区分**（硬规则 3b：读不懂/没跑，被记成与「跑了且失败」同形）。

**零控制排除**：资源闸 WAIT 路径（`:1856-1870`）被排除——同期 gds 启动器自己的 runner 在 07:50:07 / 08:03:53 / 08:15:11 均记 `resource gate says GO`；reaper 击杀被排除——被信号杀死会是 `exitCode:null` + `signalCode`（`suite-driver.ts:243-257`），而非观测到的 `exit:1`。

**影响面（同宿主 30 分钟内）**：4 个 0 字节 `fan-in-suite-*.log`（07:44 / 08:02 / 08:06 / 08:16），分属 4 个不同任务，全部被记成 `step=suite: suite red`。

**触发条件（现场事实，⛔ 不是本条的修法）**：`/tmp/gds-ac3-rounds.sh`（detached，ppid 1，仓库内无 `gds-ac3` 串）为任务 `gap-driver-start-false-confirms-unsettled-driver` 的 AC3 连跑 3 轮**全量** suite（809s / 665s），其 `--state-dir` 指向**同一个** `/home/yale/work/quay/.quay`，与 fan-in 的 in-flight 闸读同一份状态文件；`.git/full-suite.lock.concurrency` = 1（全仓单槽）。⛔ 不要 kill 该脚本——它不属于本仓库机制，本条要修的是拒绝路径的可观测性与归因。

**现有覆盖（均不覆盖本形态）**：`gap-runner-spawn-single-flight`(done) 引入了该拒绝闸但未对其可观测性提任何要求；`gap-fan-in-suite-red-reason-carries-split-or-commit-title`(done) 修的是「从日志取错行」，而本条日志为空；`gap-goal-closure-freezes-failing-ac-outside-reverify-scope`(done) 记录的 0 字节是 **15 分钟静默看门狗 SIGKILL**（`exit:null` + `hung`）——本条是**独立子形态**：取到槽 + runner 启动 + `exit:1` 拒绝。另有两个零覆盖缺口：①fan-in suite log 只捕获 stdout，runner 全部诊断不可见；②拒绝路径不写状态文件，被拒轮与「从未跑过」不可分。

## AC（draft）

- [ ] AC1（可取假）——runner 的每条「未跑就返回」分支（`:1842-1851` 单飞拒绝 / `:1856-1870` 资源闸 WAIT）在 suite log 中留下**可读的一行**（含分支名与原因）。判据：干跑一次拒绝路径 ⇒ suite log 非空且含该分支标记；负控制：闸 GO 且无在飞 runner 时该行**不出现**。
- [ ] AC2（三态可分）——被拒绝的一轮在下游与「跑了且绿」/「跑了且红」**可区分**：`mechanical_fan_in.reason`（或等价 verdict 字段）不得再出现裸 `"suite red"`，须指名「未运行（拒绝）+ 哪条分支」。
- [ ] AC3（结构量替代代理量）——消除「0 字节日志」的歧义：suite log 写入**开始标记**（或记录一条 refused 事件），使「0 字节 ⇒ runner 在 `:2556` 前返回」成为机械可判的事实。判据：附一次干跑，证明拒绝轮与非拒绝轮该标记可取假。
- [ ] AC4（生产载体验证·读产物）——落地后，取新产生的 `fan-in-suite-*.log` 中 0 字节者，其 fan-in trace 的 `reason` **不再是**裸 `"suite red"`。⚠️ 允许 not-evaluated（窗口内无新 0 字节日志 ⇒ 记 not-evaluated 并写明窗口 runs 数）——⛔ 不得用「窗口内无 0 字节日志」宣告修好。

## DoD

- 拒绝路径的每一分支在 suite log 里留可读证据；被拒轮在下游不再与真红同形。
- ⛔ 本条**不改** `isRunnerInFlight` 的判定语义本身（那是 `gap-runner-spawn-single-flight` 的产物），只修**拒绝的可观测性与归因**。
- ⛔ 本条**不动**单飞槽数与 `.concurrency`（泳道/并发旋钮属其它任务范围）。

## Touches

- plugin/scripts/suite-driver.ts
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/worker-driver.ts
- plugin/test/suite-driver.test.mjs
- tasks/gap-fan-in-suite-refusal-reports-as-suite-red.md