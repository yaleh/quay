---
id: gap-lwa-crit-fixture-sleep300-child-not-reaped-forces-aborted-on-clean-suite
title: live-web-address-fixture.mjs 的 sleep 300 夹具子进程未被回收——未 detach，既有常驻 driver
  回收机制管不到，干净完整轮也被判 aborted
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
depends_on:
  - gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping
---
## Proposal

**发现于本会话的只读 fan-in 错误审计（2026-10-15）**：真实全量轮 round 2712/2716（`gap-routine-semantic-dedup-scan-print-json-three-behaviours`/`...-list-script-basenames-diverged-under-one-name`）在 `fail=0`、且 2716 的字段证明 `plannedFiles==terminalFiles==584`、`completeness:"complete"`、`oomKill:0` 的情况下，仍被判 `state:"red" reason:"aborted"`，`notEvaluated:"leaked-processes (2)"`——leaked 的是 `/tmp/lwa-crit-* (deleted)` 目录下的 `sleep 300` 进程。

**查重结果**：全库搜索 `live-web-address-fixture`/`lwa-crit`/`leaked-processes`，命中 `gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping`（**done**）——但读其任务体确认，它的修复范围明确是**以 `detached:true` 方式 spawn 的「常驻 driver/子进程持有 stdio」**那一类泄漏（process-group kill，keyed on `child.pid` 作为 group leader），不是本缺陷这一类。**没有现有任务把 `lwa-crit` 夹具自身的子进程泄漏登记为独立对象**，故本任务新建，不是重复，也不是对已 done 任务的回归（是同一症状类别下一个未覆盖的近亲案例）。

**实测根因定位**：`packages/quay/test/helpers/live-web-address-fixture.mjs` 的 `mkRoot(prefix="lwa-crit-")` 是 7 个 `ac<NNN>-criterion-address-derivation.test.mjs` 共享的夹具工厂（`ac290`/`ac292`/`ac293`/`ac294`/`ac295`/`ac300`/`ac302`）。每个文件里的 `spawnNotAServe(root, phrase)` 这样 spawn：
```js
return spawn("/bin/sh", ["-c", `echo ${phrase} >/dev/null; sleep 300`], { cwd: root, stdio: "ignore" });
```
**没有 `detached: true`**——这正是既有 `gap-test-spawned-resident-drivers-...` 修复不会命中它的原因（该修复的 process-group kill 面向 detached 子进程）。各文件自己的 `withFixture()` 在 `finally` 里对注册进 `children`/`servers` 数组的子进程做 `killAndReap`（SIGKILL + 等 exit 事件），**正常测试路径下应当能回收**；但生产真实观察到的是它**没有**被回收——说明存在至少一条绕过该 `finally` 的路径（例如：单测自身超时/被外层 watchdog 以 SIGKILL 杀死整个测试 worker 进程，JS 层 `finally` 没有机会执行；或某个调用点没有把子进程正确登记进 `children`/`servers` 数组）。**真实失效路径由实现时的调查确认，本提案不假设是哪一条**。

## Plan

1. 复核全部 7 个消费 `spawnNotAServe`/类似夹具的测试文件，逐一确认子进程是否都被正确注册进 `withFixture` 的回收数组——若发现某个调用点遗漏注册，直接修。
2. 若 7 个文件都正确注册（即泄漏来自测试级/suite 级 watchdog 对整个 worker 的 SIGKILL，绕过 JS `finally`），修复方向转为：给这一类夹具子进程显式打标记（如独立的 cwd 前缀或一个可被进程树扫描识别的 marker argv），使**既有的 suite 级遗留进程清扫**（leak sweep）能在扫到它时主动 kill 并计入 `reaped`，而不是把它当成需要人工关注的泄漏上报——或者（视调查结果二选一，不强行两者都做）让这类夹具子进程本身也用 `detached:true` + 对应的 teardown，使其自然落入已有的 process-group 回收机制，复用现有机制而不是另造一套。
3. **不放宽**：不能把"检测到遗留进程"这件事本身弱化或跳过判定（`leakedProcesses`/`notEvaluated` 的既有契约、以及这条判定对真实泄漏的灵敏度必须保持），本任务只修"这一类**已知、测试自身制造的**子进程没被按设计回收"，不是放宽泄漏检测本身。
4. 保持与 `gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping` 既有机制并存、不冲突：新修复若复用/扩展该文件的回收路径，须保证其原有 AC1/AC2 的两个方向（泄漏必被抓、干净轮不多出 leak key）继续成立。
5. **验证方式按本次授权收窄**：隔离 worktree 内直接跑受影响的 7 个 `ac<NNN>-criterion-address-derivation.test.mjs`（+ 必要的 `worktree-process-reaper`/resident-driver 相关单测）做受控局部验证，`scripts/test.sh --for-task <this task>` scoped 门禁即可，**不要求触发一次昂贵的全量 `scripts/test.sh` 跑**，不部署，不重启任何生产/共享服务。

## Acceptance Criteria

- [x] AC1: 逐一核对 7 个消费该夹具的测试文件（`ac290`/`ac292`/`ac293`/`ac294`/`ac295`/`ac300`/`ac302`），确认泄漏的真实触发路径（遗漏注册 / 外层 SIGKILL 绕过 finally / 其它），粘贴调查结论。 —— 结论 = Plan 未列的**第三条**：既不是遗漏注册，也不是外层 SIGKILL 绕过 `finally`。①**注册面**：7 文件共 14 处 `spawnNotAServe` 调用（每文件恰 2 处），**全部**形如 `children.push(spawnNotAServe(root))`（ac290:334,493 / ac292:334,493 / ac293:273,432 / ac294:278,437 / ac295:279,438 / ac300:273,432 / ac302:398,557），无一处漏注册 ⇒ 排除「遗漏注册」。②**真因 = 直接子进程 fork 出孙进程，而 teardown 只按 `child.pid` 杀直接子进程**：`sh -c "echo <phrase> >/dev/null; sleep 300"`，本机 `/bin/sh`→dash，而 dash 对 `;` 列表的**最后一条命令不 exec 而是 fork**（实测：`/bin/dash` 直接子进程 forked children=**1**，`/bin/bash`=**0**）⇒ `child.pid` 是 shell、`sleep 300` 是孙进程；`withFixture` 的 `finally` 里 `killAndReap(child)` **正常执行且正常 resolve**（不是没跑），但只杀到 shell——`sleep` 被孤儿化、保留（已被 `rmSync` 的）temp root 作 cwd，且仍在 suite 自己的进程组内，遂在 suite 末尾 leak 扫描被正确判为泄漏。③该路径**在正常 `finally` 路径上即发生**（AC2 负控制走的正是 `finally`），不需要外层 SIGKILL 参与。④附带实测：同一 `sh -c` 形状在 bash 上会被 exec，直接子进程 cmdline 变成 `sleep 300`（`quay.ts serve` 消失）⇒ 旧夹具形态本身宿主依赖，新形态（`read`，两 shell 都是内建）不依赖该差异。
- [x] AC2: 修复后，针对确认的真实触发路径构造一个可复现的负控制（修复前能复现泄漏，修复后不再泄漏），粘贴修复前/修复后两次读数对比。 —— 负控制脚本 `/tmp/lwa-probe/negative-control.mjs`：两臂使用 worktree helper 里**同一个真实 `killAndReap`**，唯一变量是 spawn 形状；各臂用独立 temp 前缀以便归属（避免与当时并发跑着的生产 suite 的 `lwa-crit-*` 泄漏混淆）。**BEFORE（develop 形状）**：直接子进程 pid=3672367，cmdline=`/bin/sh -c echo quay.ts serve >/dev/null; sleep 300`，forked children=**1**；teardown 后 SURVIVORS=**1**（pid=3672368 `sleep 300`，cwd=`/tmp/lwa-nc-before-GGBgPR (deleted)`）。**AFTER（修复）**：pid=3674217，cmdline=`...; read _`，forked children=**0**；SURVIVORS=**0**。`VERDICT: before=1 survivor(s), after=0 survivor(s)`。另测 Plan 的另一条假设路径（父进程被 SIGKILL、`finally` 根本没机会跑，脚本 `/tmp/lwa-probe/self-clean.mjs`）：BEFORE 1.5s 后仍存活=**true**（cwd=`/tmp/lwa-sc-before-T0Qr9P`），AFTER 存活=**false**（shell 的 `read` 见 EOF 自行退出）。
- [x] AC3: 一个真正的、非本夹具制造的遗留进程（即真实需要被上报的泄漏）修复后仍被正确检测、仍计入 `leakedProcesses`/`notEvaluated`——不得因为本修复而让检测面变窄（硬规则 2 的镜像：零计数也要配一个"谓词对真样本命中"的对照）。 —— 正控制 `/tmp/lwa-probe/positive-control.mjs`，两个检测面**均未改动**：①suite 末尾扫描（`listProcessGroupMembers`/`reapLeakedSuiteProcesses`，`plugin/scripts/full-suite-runner.ts`）对一个真正的 **3 进程泄漏组**（pgid=3705841）仍报 `leaked=3, reaped=true`（pids 3705841,3705842,3705843）——即仍会计入 `leakedProcesses` / `notEvaluated:"leaked-processes (n)"` 的那个量；且不存在的组仍读作 `leaked=0, reaped=true`（「查过且干净」与「找到泄漏」不共用取值，硬规则 3b）。②`worktree-process-reaper --worktree <dir>` 对真实孤儿仍 `found=2 killed=2`（一个 `/bin/sh` 及其 fork 出的 `sleep`）。本修复**未触碰**任何检测面（见 AC5 的零命中 diff 证据），故检测面只增不减。
- [x] AC4: 与既有 `gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping` 的 AC1/AC2 不冲突——其既有测试（成功/失败/超时/取消四态 process-group 回收 + suite-end backstop）修复后仍全绿（粘贴证据）。 —— `plugin/test/full-suite-runner-cgroup.test.mjs` 中该任务的目标用例**全绿**：`✔ AC2 — suite-end backstop: a leaked resident child yields not-evaluated: leaked-processes (1), reaped (1435.6ms)`、`✔ AC2 negative control — a clean round adds NO leak key and stays green (826.5ms)`、`✔ AC1 post-fix — SUCCESS path (2560.4ms)`、`✔ FAILURE path (404.4ms)`、`✔ TIMEOUT path (494.9ms)`、`✔ CANCELLATION path (411.3ms)`、`✔ AC1 negative control — a BARE spawn (no helper) leaks: the driver SURVIVES the test (449.7ms)`；`plugin/test/promotion-driver-s03.test.mjs` **7/7 pass**。⚠️ 同一次运行另有 **3 个与本修复无关**的红：`AC1`/`AC4`/`AC6` 三个**真 `systemd-run --user --scope`** 用例各自卡在 60s `waitExit` 界上（63.6s / 60.0s / 60.1s；`waitExit: child … did not exit within 60000ms`，栈指向 `plugin/test/helpers/full-suite-runner-harness.mjs:206`），当时宿主 **loadavg 310–366**（生产 fan-in suite 自 13:39:55 起以 `--test-concurrency=128` 在跑，20k+ 线程）。归因证据（硬规则 4 推论四的对照）：①**结构面**：本 diff 的 8 个文件与该测试的 import 面零交集——`grep -c "live-web-address-fixture\|ac290-criterion\|ac302-criterion" plugin/test/full-suite-runner-cgroup.test.mjs plugin/scripts/full-suite-runner.ts` = **0 / 0**；②**对照**：同样这 3 个用例隔离重跑（同一 worktree、同一代码）**全绿**：8.9s / 2.1s / 3.1s（loadavg 243）⇒ 60s 界只在「与生产 suite + 我自己的 scoped 门」并发时被击穿，属宿主负载整形，非本修复引入。
- [x] AC5: 不放宽 leak/OOM 判定灵敏度，不提高 16GiB `MemoryMax` 等内存上限（grep/diff 证据）；原测试覆盖未被削减。 —— `git diff develop...HEAD --stat` = **8 个文件**（全部在 Touches 内）；diff 内命中数：`MemoryMax`=0、`16GiB`=0、`leakedProcesses`=0、`QUAY_MAX_CONCURRENT_SUITES`=0、`gate-gameability`=0、`LEAK_SWEEP`=0、`tolerance`=0（`notEvaluated` 唯一 1 处是新增注释里引用症状原文，⛔ 非代码）；删除行中含 `test(` 的 = **0**；`^test(` 声明数 7 文件逐一 `develop == worktree`（16/16、16/16、14/14、13/13、14/14、15/15、19/19）⇒ 无测试被删、无判定被放宽。`plugin/scripts/worktree-process-reaper.ts` 虽在 Touches 内但**未被改动**（该 `sleep` 类残留由 suite 末尾扫描按进程组回收，reaper 的 `--orphans` 谓词面向 `claude-probe`/陈旧锁持有者，无需扩面）。
- [x] AC6: `scripts/test.sh --for-task <this task>` 的 scoped 门禁绿；本任务验收范围按人 2026-10-15 裁定收窄为隔离 worktree 内受控局部验证（7 个相关文件直跑 + scoped 门禁），不要求/不触发一次完整全量 `scripts/test.sh` 跑作为验收证据。 —— `bash <wt>/scripts/test.sh --for-task gap-lwa-crit-fixture-sleep300-child-not-reaped-forces-aborted-on-clean-suite --allow-thin` ⇒ **exit 0**；其测试段 TAP：`ℹ tests 133 / pass 133 / fail 0 / cancelled 0 / skipped 0`（= 7 个 ac 文件 107 条 + `plugin/test/worktree-process-reaper.test.mjs` 26 条），7 个 ac 文件的用例在输出中逐个可见（各含 `✔ no serve process at all: the verbatim no-running-serve-instance branch, with the report`）。另外单独直跑 7 个文件：`ℹ tests 107 / pass 107 / fail 0`。按裁定范围**未触发**全量跑，未部署、未重启任何生产/共享服务，未触碰主机资源配置或预算。

## Definition of Done

- AC1-6 均带真实或受控 fixture 粘贴证据勾选。
- 不部署、不重启任何生产或共享服务（含 ClaudeCodeUI 的 anchor/driver），不触碰主机资源配置或预算。
- 现有测试覆盖与门禁未被削弱；不忽略/屏蔽任何 leak 或 OOM 判定。

## Touches
- packages/quay/test/helpers/live-web-address-fixture.mjs
- packages/quay/test/ac290-criterion-address-derivation.test.mjs
- packages/quay/test/ac292-criterion-address-derivation.test.mjs
- packages/quay/test/ac293-criterion-address-derivation.test.mjs
- packages/quay/test/ac294-criterion-address-derivation.test.mjs
- packages/quay/test/ac295-criterion-address-derivation.test.mjs
- packages/quay/test/ac300-criterion-address-derivation.test.mjs
- packages/quay/test/ac302-criterion-address-derivation.test.mjs
- plugin/scripts/worktree-process-reaper.ts

## Disposition

**第二轮派发（复核轮）2026-10-15**：第一轮的实现（提交 `a81f0b5d7`）已在本任务分支上；第一轮的 blocker 落在 **fan-in 的 suite 步骤**（`oom-killed (1)`，降档 64/48/32 均无完整判定），不在本 diff 的 8 个文件内。本轮在隔离 worktree 内逐条重跑 AC1–AC6，读数与第一轮一致，并补了第一轮没有的证据面：

- **AC1 重测（本机，独立）**：`/bin/sh`(→dash) 对 `;` 列表末条命令**不 exec 而 fork** —— 直接子进程 forked_children=**1**（子进程 cmdline=`sleep 5`）；`/bin/bash` = **0**（直接子进程 cmdline 已是 `sleep 5`）。7 文件的 `spawnNotAServe` 调用点 = **14**，全部 `children.push(...)`=**14**（develop 侧 21 = 7 个定义 + 14 个调用点）⇒ 无一处漏注册，与第一轮结论同。
- **AC2 重测（改用出货谓词，非自写 cwd 扫描）**：两臂共用 worktree 里**同一个真实 `killAndReap`**，幸存者读数改用**出货的** `listProcessGroupMembers`（`plugin/scripts/full-suite-runner.ts`）。BEFORE（develop 形状）：直接子进程 cmdline=`/bin/sh -c echo quay.ts serve >/dev/null; sleep 300`、forked=1，teardown 后谓词读 **leaked=1**（`sleep 300`，cwd=`/tmp/lwa-nc2-before-2sDnIa (deleted)`——与生产症状同形）；AFTER（修复形状）：cmdline=`…; read _`、forked=0、**leaked=0**。
- **AC3 重测**：真实 3 进程泄漏组（pgid 50024）仍读 **leaked=3, reaped=true**；不存在的组读 **leaked=0**（「查过且干净」与「找到泄漏」不共用取值）；`worktree-process-reaper --worktree <dir>` 对真实孤儿仍 **found=2 killed=2**。
- **AC4 重测（合并 develop 后的树）**：`plugin/test/full-suite-runner-cgroup.test.mjs` 的常驻 driver 用例 **7/7 全绿**（suite-end backstop / 干净轮负控制 / SUCCESS / FAILURE / TIMEOUT / CANCELLATION / BARE spawn 负控制），`promotion-driver-s03.test.mjs` **7/7 全绿**。第一轮记录的 3 个 60s `waitExit` 红本轮**未复现**（loadavg 22–48）——与第一轮的宿主负载归因一致。
- **AC5 重测**：`git diff develop...HEAD --stat` = **8 文件**；diff 新增行内 `MemoryMax`/`16GiB`/`leakedProcesses`/`QUAY_MAX_CONCURRENT_SUITES`/`gate-gameability`/`LEAK_SWEEP`/`tolerance` 命中数均为 **0**；`notEvaluated` 唯一 1 处经**打印该行原文**核对为 `//` 注释（硬规则 2：按位置判定）；删除行含 `test(` = **0**；7 文件 `^test(` 声明数 develop==worktree（16/16、16/16、14/14、13/13、14/14、15/15、19/19）。
- **AC6 重测**：`scripts/test.sh --for-task … --allow-thin` **exit 0**，`tests 133 / pass 133 / fail 0`（7 个 ac 文件各自的共享断言共 **7** 处可见 + `worktree-process-reaper.test.mjs`）；合并 develop（`e14887ccb`）后在该树上**重跑仍绿**。
- **5b 类面扫描（本轮新增，非修复范围）**：全库扫 `sleep 300` 与 `sh -c` spawn 形状 ⇒ 本缺陷类（末条命令为外部命令而被 dash fork、而 teardown 只杀直接子进程）**只存在于这 7 个文件的那一份共享副本**。`ac288/296/297/298/299/303` 虽各带 `killAndReap`/`killQuietly` 副本，但一律用 `process.execPath`（node `-e`）**直接起进程、不经 shell**，不属该类（其副本重复属另一类整洁性问题，不在本任务范围）。其余 `sh -c` spawn 用 `bash`（末条命令会被 exec）、末条为**内建**命令、或本就 `detached:true` 自行收尾，均无此形态。
- **本轮结局**：scoped 门绿 + `anti-drift-touches-check` 报 `8 actual file(s), all within declared Touches`；worktree 已 merge develop 并提交。剩余风险仍在 fan-in 的 **suite 步骤**（宿主/全量 suite 内存包络这一类）；本 diff 未触及任何内存或并发旋钮（见 AC5 读数）。scoped-gate 缓存为**单记录**文件（peer 可覆盖），故未命中时 fan-in 照跑 scoped 门属预期行为。
