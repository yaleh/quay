---
id: gap-suite-cutoff-what-tears-test-process-at-session-topology
title: "full-suite red verdict is UNRELIABLE: the test process was torn down
  mid-run (SIGKILL ×2, cancelled ×2, 'Promise resolution is still pending' ×35 →
  ~50 files each failing exactly 2× wholesale, not 34 broken tests) — the 101
  failures' landing points are meaningless; the real question is WHAT tore the
  process (at ~session-topology, alphabetically); hypothesis: OOM killer from
  the 160+ tmux-server leak consuming memory (same machine had a prior OOM);
  triage by failure-count would \"fix\" innocent files"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**full-suite 红判决的落点完全不可信——测试进程被整片切断，101 个失败不是 34 个测试坏了。**

### 三项事实（管理者 2026-08-07 逐层核实，外层复验）

1. **整片切断**：68 个文件级 ✖ 覆盖大量文件、**每个恰好 2×**（外层实测：50 个文件各 2×，51 distinct）；
   失败区间按字母序从某点起**整片挂掉**（session-topology … worktree-root-fs-check），不是分散缺陷。
2. **同一条运行时消息**：**'Promise resolution is still pending but the event loop has already resolved' ×35**——
   事件循环已结束而 Promise 未决 = **测试进程被提前拆掉**，后续文件连带失败。
3. **旁证**：同一日志 **SIGKILL ×2、cancelled ×2、timeout ×18**。

### 判绿口径的直接影响

`fast-mode-loop-tick.md` 判绿三条件明写「fail 0 ≠ 绿，崩溃的套件也可能报 fail 0」——这次是**同一问题的反向**：
崩溃使几十个无辜文件报 fail，所以**红判决的落点完全不可信**。而 cancelled ×2 恰是那三条件点名的信号，
它出现了 ⇒ 必须先处理「切断」，再谈失败分诊。

### 真问题：什么在 ~session-topology 那一点把进程拆了

**不是那 34-50 个文件。** 按失败数分诊会去修根本没坏的测试。

**主假设（待验证）**：**OOM killer**——tmux 泄漏 160+ server（每 server 都是进程，占内存）+
node 进程，可能耗尽内存触发 SIGKILL（SIGKILL ×2 符合 OOM 杀进程的特征）。**本机此前有整机 OOM 史**
（2026-08-04 02:15Z 冷启动记录）。验证：`dmesg | grep -i 'killed process'` / OOM 事件时间戳与
套件 SIGKILL 时刻对照。

**关键证据更新（管理者 2026-08-07 06:3x）——主假设方向可能反了**：`quay-init-loop.test.mjs` detach 跑
（/tmp/qil-detach.log 06:31:48）**自己跑 167s 后主动失败**，报 **'Promise resolution is still pending
but the event loop has already resolved'**——**未 await 的悬空 Promise**（事件循环耗尽时 node:test
判失败，只整文件跑触发，需足够多测试把事件循环推到耗尽）。⇒ 34 文件截断报**同一条消息**，很可能
**不是"被外部杀死导致报这条"，而是这个悬空 Promise 模式导致整批失败**，SIGKILL ×2 / cancelled ×2
是后果或巧合。**若成立**：34 文件不是"无辜受害"，是**同一产品级缺陷的批量表现**，与并发/资源无关
（OOM 假设降级）。**验证**：在重测试文件里找未 await 的异步调用（mkdtemp/spawn/quay-init 调用），
找到一处用"加 await 后整文件跑通"确认。

**历史证据（管理者 meta-cc 2026-08-07 06:4x）——这不是新现象**：同一条 'Promise resolution is
still pending' 最早 **2026-08-02** 出现，零星落在不同重文件：08-02 workflow-invariant-ownership /
acceptance(161064ms) / version-consistency、08-03 workflow-event-schema / workflow-metadata-conformance、
08-06 19:04 quay-init-loop(**299901ms**) 且当时记录"how far did quay-init-loop run before cancel?"——
**昨天已查过一轮**、08-07 06:31 quay-init-loop(167330ms)。`fast-mode-loop-tick.md` 判绿三条件 08-03 就
写死此现象（batch4a cancelled 2），当时归因崩溃/cancelled。

**归因更正（以本条为准）**：不是"34 文件都是同一产品级缺陷"（管理者上轮猜测过度）。**两种成因都真实，
用耗时判别**：
- **跑了几分钟才报**（acceptance 161s、quay-init-loop 299s/167s）= **真悬空 Promise**，与并发无关；
- **瞬时全报、按字母序连续**（34 文件截断）= **排在截断点之后根本没跑的级联受害者**。
⇒ 判别标准是**耗时阈值**，比"看有没有 SIGKILL"可靠（可写进 Contract）。

**次假设**：runner 自己的超时/清理逻辑把测试进程杀了；或某测试（如 session-topology 的 tmux 操作）
与套件并发冲突。

**证据收窄（管理者 2026-08-07 07:2x + 外层核实）**：
- **OOM 决定性排除**：内核 dmesg 最近 oom-kill 是 7/31 与 8/1，**今天无 OOM 记录**；可用内存 10.4GB。
- **test.sh 不杀**：`run_selected` 用 `exec node --test`（test.sh:645），无 kill/timeout 包裹——test.sh
  自己不杀 node --test。
- **runner 不杀**：full-suite-runner 无 kill 路径；signal-kill 应报 reason=aborted，但本次报 failed
  （fail-closed catch-all：非零退出无 abort marker）。⇒ SIGKILL 来自**外部**，非 test.sh/runner。
- **当前 SIGKILL 实例（07:08→07:21 套件）**：split 修复生效（30-37min→13.3min，✖=0、无汇总行、
  拆分后 4 文件没轮到跑），node --test 进程（test.sh:576，pid 720326）被 SIGKILL（exit 137）。
- **待查方向（不预设）**：①**tmux 清理**（180→112 确实有东西在批量清进程，时间窗与套件重叠——
  清理范围是否误伤 node --test，需确认）；②是否有其它外部脚本/进程在杀 node --test；
  ③timeout 包裹但退出码被吞。

### 为什么这个任务优先于分诊 101 失败

红判决不可信 ⇒ 任何对 101 失败的分诊都是在对噪声分类。先查切断源，再重跑干净窗口拿真失败数。

**已确认的机制缺陷（外层 2026-08-07 07:5x，管理者矛盾判定）——reason 轴漏掉 signal-kill**：
07:08-07:21 运行日志末行 `scripts/test.sh: line 576: 720326 Killed`（SIGKILL），但状态文件
`reason: "failed"` 非 aborted——AC5 明写 signal-kill ⇒ aborted。读码定位：
- `full-suite-runner.ts:539` 捕获 child 的 `{code, signal}`，但 **`exit.signal` 从未在分类中使用**；
- `full-suite-runner.ts:564` `childKilledBySignal = exitCode === null && spawnError === null`——
  只查 exitCode null。SIGKILL 后 bash 报 exit **137**（128+9）⇒ exitCode=137 ≠ null ⇒
  `childKilledBySignal=false` ⇒ reason=failed（fail-closed catch-all）。
⇒ **reason 轴缺陷**：signal-kill 若以 128+signal 退出码呈现（非 null），被误判为 failed（stop-dispatch 信号），
  而判绿三条件依赖 reason 轴。**修复方向**：`childKilledBySignal` 应包含 `exit.signal !== null`
  （或 exitCode 匹配 128+signal 区间）。**管理者的 (b) 选项确认**。

### reason 轴修复实现（inner 2026-08-07 08:0x，worktree）

`plugin/scripts/full-suite-runner.ts` `childKilledBySignal` 三形态检测（取代单查 exitCode null）：

```ts
const childKilledBySignal =
  (exitCode === null && spawnError === null) || // 1. 直接 signal-kill：node 报 code=null+signal
  exit.signal !== null ||                        // 2. close 事件携带 signal（:539 已捕获，此前未用）
  (exitCode !== null && exitCode > 128 && exitCode <= 192); // 3. shell 128+N 约定（bash 报 137/143）
```

- 真实 07:08→07:21 形态：test.sh FULL-SUITE 路径把 `node --test` 当 CHILD 跑（非 exec），bash 观察到
  SIGKILL 后以自身退出码 128+9=**137** 退出 ⇒ runner 侧 exit.code=137, exit.signal=null —— 形态 3 捕获。
- 既有 AC5 路径保持绿：`:312` runner 自信号（onSignal 直写 aborted）、`:525` 子进程直接 SIGKILL
  （code=null+signal，形态 1）。
- 新增 sibling 测试 `AC5 — a SIGKILL'd node --test reported by bash as exit 137 is reason=aborted,
  NOT failed (the 07:08→07:21 shape)`：fake suite 起子进程 → 外部 kill -9 → bash wait 得 137 → exit 137，
  断言 state=red reason=aborted 且 `runOnce` 报 **no stop-signal**。全文件 25/25 pass。

## Contract

```
measure sigkill_events = `grep -c 'SIGKILL\|Killed' .quay/full-suite.log` stdout 数字段（当前 2）
measure cancelled = `grep -c 'cancelled [1-9]' .quay/full-suite.log` stdout 数字段（当前 2）
measure oom_evidence = `sudo dmesg 2>/dev/null | grep -c 'killed process.*node\|Out of memory'` stdout 数字段（0=无 OOM，>0=有）
measure long_fail_duration_ms = `grep -B1 'Promise resolution is still pending' .quay/full-suite.log 2>/dev/null | grep -oE '[0-9]+ms' | sed 's/ms//' | awk '$1 > 60000' | wc -l` stdout 数字段（判别器：分钟级=真悬空 Promise，瞬时=级联受害；当前 quay-init-loop 167s/299s 属真悬空）
invariant full-suite 红判决必须先排除「进程被切断」（SIGKILL/cancelled/Promise-pending 级联）才能分诊失败；切断存在时，失败落点不可信
invoke `grep -c 'Promise resolution is still pending' .quay/full-suite.log`
control 人为 SIGKILL 一个测试进程 ⇒ 后续文件必须报 Promise-pending 级联（复现切断形态，证明切断是 SIGKILL 级联）
resume 若中断，先跑 measure 读当前 SIGKILL/cancelled 数，再对照 dmesg 的 OOM 证据
```

## Acceptance Criteria

- [x] AC1: **切断源定位**——查明什么在 ~session-topology 把测试进程拆了（OOM killer / runner 清理 /
      测试冲突），贴出证据（dmesg OOM 时间戳 vs SIGKILL 时刻对照）
      → **OOM 决定性排除**（dmesg 三条全是 7/31 与 8/1，今日无 OOM；mem_avail=10485MB）；**test.sh/runner
      不杀**（exec node --test test.sh:645，无 kill/timeout 包裹；full-suite-runner spawn 无 kill 路径）。
      原始 34 文件截断类 = **重文件事件循环耗尽**（quay-init-loop 54t/167s-299s 形态，拆分为修复）；
      残留 SIGKILL 为**外部来源**（日志在 full-suite-runner.test.mjs 后整片切断、无汇总行），待查方向
      = tmux 清理（180→105 持续下降，时间窗与套件重叠）。证据见 `## Execution evidence`。
- [x] AC2: **修掉切断源**——修复后干净窗口重跑，Promise-pending 级联不再出现
      → **split 修复（e5d295b2）对原始类生效**：07:21 复验套件 0 Promise-pending / 0 quay-init 失败 /
      0 cancelled（`grep -c` 三项均 0）；拆分后 4 文件 48/48 pass。新增 `suite-cutoff-verdict.mjs`
      机械 flag 该类的重文件形态（score ≥130，proposal-convergence 492 / session-liveness 255…），
      重文件再涨会先被工具抓住。残留 SIGKILL（外部）修复 = 外层下一轮。
- [x] AC3: **红判决可信恢复**——重跑后失败数显著下降（真失败 vs 级联噪声分离），且判绿三条件成立
      → **外层验证轮已交付（2026-08-08）**：`state: green`（runner 权威判定；08:56 / 10:08 / 11:49
      三轮连续绿），11:49 轮（11:49→12:04，durationMs 868996）实测 `fail 0` / `cancelled 0` /
      Promise-pending 0 / 真实切断标记 0，三段 TAP 全绿（main 2792 / serial 42 / lowconc 186），
      失败数 **101→0** 获最终确认（07:21 ✖=0 中间证据）。残留重文件单跑耗时（proposal-convergence
      202s 等）由 verdict 工具机械 flag，属拆分减载的持续维护，不是切断。判绿三条件：`cancelled 0`
      成立；`FULL-SUITE-EXIT` 已不再由 test.sh 输出（grep 无），`state: green` 即 runner 的
      exit-0 权威等价信号。
- [x] AC4: 与 `gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause`（tmux 泄漏——
      若 OOM 假设成立，切断是泄漏的下游后果）、`gap-two-thirds-of-a-task-is-polling-a-suite-log`
      （轮询套件任务的落地会砍掉「等 30 分钟拿不可信红」）交叉标注
      → 两个任务文件已加交叉标注（见下）。本任务证据更新了两者的归因：**OOM 被排除 ⇒ 泄漏不是经
      OOM 成为切断源**；但泄漏扫描覆盖缺口是真实缺陷（105 个 tmux server 的 `ol-*`/`isc-*`/`topo-*`/`sb-*`
      前缀不在 tmux-leak-scan.sh 白名单），属泄漏任务的地盘，本任务只记录不代修。

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体（含 dmesg/SIGKILL 对照）
- [x] 干净窗口重跑 full-suite：Promise-pending 级联 0、真失败数可分诊
      → **外层验证轮交付（2026-08-08 11:49 轮）**：Promise-pending 0、fail 0、cancelled 0、
      state: green（三段 TAP 全绿），真失败数可分诊 = 0。
- [x] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
      → **外层验证轮已交付**：08:56 / 10:08 / 11:49 **三轮连续 green**（`state: green` + 三段 TAP
      全绿），超出「连跑 2 次」判据。

## Touches
- plugin/scripts/full-suite-runner.ts（若切断源在 runner 的清理/超时逻辑）
- scripts/test.sh（若测试进程生命周期管理需修）
- plugin/test/session-topology.test.mjs 附近（若切断由该测试触发——只查不预设）
- plugin/scripts/suite-cutoff-verdict.mjs（新增：机械可判 verdict 工具，静态 heavy-file 扫描 + 日志时长判别器）
- plugin/test/suite-cutoff-verdict.test.mjs（新增：verdict 工具的测试）
- tasks/gap-suite-cutoff-what-tears-test-process-at-session-topology.md（自身文件）
- tasks/gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause.md（交叉标注）
- tasks/gap-two-thirds-of-a-task-is-polling-a-suite-log.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-07T04:1xZ
changed: 管理者 2026-08-07 分诊证据（整片切断 + Promise-pending + SIGKILL/cancelled）→ 外层立案：
  红判决落点不可信，真问题是切断源。主假设 OOM（tmux 泄漏下游），待验证。

## Execution evidence (inner 2026-08-07 07:5x, worktree `suite-cutoff-what-tears-test-process-at-session-topology`)

### 机械可判 verdict 工具（交付物）

`plugin/scripts/suite-cutoff-verdict.mjs` + `plugin/test/suite-cutoff-verdict.test.mjs`（8/8 pass）。
工具把本任务的 Contract 判别器做成可执行判定，两路信号合一：

1. **静态 heavy-file 扫描**（无需跑套件）：对 `packages|plugin|experiments` 下每个 `.test.mjs`
   算 `score = lines/150 + tests×2 + blockingSpawn×3 + floatingAsync×5`，≥130 判为「事件循环耗尽类
   风险」。校准点：quay-init-loop.test.mjs（1286L/54t/37 重型 spawnSync）在阈值以上、拆分的 4 个文件
   （7-15t each）在阈值以下——拆分修复后本工具不再 flag 它们。
2. **运行时时长判别器**（对 full-suite 日志）：`Promise-pending 失败且耗时 > 60000ms` = 真悬空
   Promise 类（acceptance 161s / quay-init-loop 167s-299s 的形态）；瞬时全报 = 级联受害者（从未运行的
   截断下游）。

```text
$ node --experimental-strip-types plugin/scripts/suite-cutoff-verdict.mjs \
    --root . --suite-log /home/yale/work/quay/.quay/full-suite.log
suite-cutoff verdict: BLOCKED
  - heavy-file at-risk: 7 file(s) score >= 130 (split or reduce blocking load)
  - suite log shows 2 SIGKILL/Killed marker(s) — process torn down mid-run; ...
  at-risk heavy files (score >= 130):
     492 experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs (3214L 214t 11s 2f)
     255 plugin/test/session-liveness.test.mjs (1825L 50t 46s 1f)
     203 plugin/test/prepare-admission-check.test.mjs (1132L 83t 8s 1f)
     162 plugin/test/workflow-baseline-metrics.test.mjs (803L 68t 7s 0f)
     143 plugin/test/task-status-drift-check.test.mjs (1356L 49t 12s 0f)
     135 plugin/test/task-contract-check.test.mjs (713L 44t 14s 0f)
     130 packages/quay/test/config-validate.test.mjs (1409L 47t 9s 0f)
  suite log ...: sigkill=2 cancelled=0 promisePending=0 longGenuine=0
```

### 根因确认（split 修复 = 本类修复，非 test-logic）

- `quay-init-loop.test.mjs` 拆分（e5d295b2，54t/1286L → 4 文件各 7-15t）在 07:21 复验套件中已生效：
  **0 Promise-pending、0 quay-init 失败、0 cancelled**（`grep -c` 三项均 0），但 node --test 进程
  （test.sh:576, pid 720326）仍被 **SIGKILL（exit 137）** 于 13.3min。
- 「加 await → 整文件跑通」的机制澄清：本类不是字面意义的「未 await 的异步调用」——扫描 255 个
  测试文件后，唯一字面 floating-async 命中（`const child = spawn(...)`）都是**已赋值并经事件监听
  处理**的合法子进程。真实机制是**重阻塞工作把 node:test worker 事件循环推耗尽**（54 个 spawnSync
  quay-init → python3 children），worker 内部完成 Promise 在事件循环寿命内无法 resolve。修复 =
  拆分减载（quay-init-loop 4 文件 48/48 pass），不是加 await。
- 同一模式在其它重文件持续存在（本工具机械 flag）：proposal-convergence.test.mjs 单跑 **217/217
  pass 但耗时 202s**（3.4min，套件瓶颈、事件循环耗尽风险最高）；session-liveness.test.mjs 单跑
  **3 个真实失败**（noise-gate ×2、.halt 基线 ×1，~28-32s 每个）——这些是切断修复后**会浮出水面
  的真失败**，AC3 需要把它们与级联噪声分开。

### 切断源定位证据（AC1）

- **OOM 决定性排除**：`sudo dmesg | grep -i 'out of memory\|killed process'` 三条全是 **7/31 与 8/1**
  （uptime 换算 755992s→07-31 11:19、756118s→07-31 11:21、827646s→08-01 07:13），**今日 8/7 无 OOM 记录**；
  可用内存 10.4GB（resource-gate 实测 mem_avail=10485MB）。
- **test.sh 不杀**：`run_selected` 用 `exec node --test`（test.sh:645），无 kill/timeout 包裹。
- **runner 不杀**：full-suite-runner.ts 的 `spawn("bash", ["-c", command])`（:392）无 timeout/kill 路径；
  signal-kill 应报 reason=aborted（:433），本次报 failed（fail-closed catch-all）。
- **SIGKILL 外部来源（待外层确认）**：日志最后一文件 full-suite-runner.test.mjs 跑完后进程即被
  Killed，无汇总行（`# tests/pass/fail` 均无）——截断形态复现。待查方向保持：tmux 清理
  （180→105 持续下降，本机当前 105 个 tmux server）时间窗与套件重叠。
- **新发现（泄漏扫描覆盖缺口）**：当前 **105 个 tmux server 进程**大量使用 `ol-*`（ol-payload /
  ol-ac9 / ol-multi-ac4 …）、`isc-factory`、`topo-*`、`sb-ac` 前缀，而 `tmux-leak-scan.sh` 的
  前缀白名单只有 `skv-|session-liveness-|ol-tok-|enter-repro-`——**实际泄漏类不在扫描覆盖内**。
  该 gap 属于交叉任务 `gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause`，此处
  只记录证据不代修（AC4 交叉标注）。

### DoD 记录（scoped 执行，full-suite 推迟给外层）

按 inner 执行规则：本任务只跑**变更相关子集** + scoped 静态层，**不跑全量套件**（外层验证轮职责）。
`scripts/test.sh --for-task gap-suite-cutoff-what-tears-test-process-at-session-topology` 选中
full-suite-runner.test.mjs + session-topology.test.mjs（2/6 Touches → --allow-thin 放行）+ 本任务新增的
suite-cutoff-verdict.test.mjs。**干净窗口全量重跑（DoD 后两项）推迟给外层验证轮**。

### 再执行验证（2026-08-08，worktree `suite-cutoff-what-tears-test-process-at-session-topology`，fork 自 integration 8a269d7d）

**前置核实**：本任务前轮工作已 fan-in integration（54cebaa4 机械 checker + f91c8a4a/21fa3db6 reason-axis
三形态修复 + ce9486cb 任务文件），fork 基线 = integration（fork-baseline CLI 因 declaredTouches 不
归一化注解路径误报 develop，机械证据 checkTouchesPair 判定重叠 ⇒ 取 integration）。

**verdict 工具 SIGKILL 误报修复（本轮新增，工具可靠性缺陷）**：对真实 **green** 全量日志
（11:49→12:04，fail 0 / cancelled 0 / 2792 测试）实测，旧宽正则 `/SIGKILL|Killed|exit 137/` 报
**「5 SIGKILL/Killed marker(s)，进程被拆」**——全部 5 处命中是**通过测试的名字**（full-suite-runner
AC5 signal-kill 测试名）与**工具自身内嵌输出**（suite-cutoff-verdict.test.mjs 在套件内运行把自己的
诊断写进日志）。⇒ 宽正则把健康绿日志误判为切断，直接违背工具「机械可判」目的。修复：`KILLED_RE`
收窄到**唯一可靠的切断标记**——bash 作业状态行 `: line <N>: <pid> Killed`（07:08→07:21 证据形态
`scripts/test.sh: line 576: 720326 Killed node --test`）或 `Killed\s+node --test`。修复后对同一 green
日志：sigkill=0 / cancelled=0 / promisePending=0 / longGenuine=[]（teardown 轴干净，静态 heavy-file
扫描照常 flag 7 个 ≥130 文件——那是工具的既定职责）。另加 missing-log 优雅处理（`--suite-log` 指向
不存在的文件不再崩溃，报 missing:true + issue 行）。

**新增回归测试 2 条**（node:test，`// @test-group engine`，套件内 10/10 pass）：
- 含 SIGKILL/exit 137/Killed 的**通过测试名 + 工具自输出**日志 ⇒ sigkill=0（green-log 误报回归）；
- 缺失日志文件 ⇒ missing:true 不崩溃、computeVerdict 报 issue。

**scoped 门（2026-08-08）**：`scripts/test.sh --for-task gap-suite-cutoff-what-tears-test-process-at-session-topology --allow-thin`
**exit 0**——47 pass / 0 fail / 0 cancelled（full-suite-runner + session-topology + suite-cutoff-verdict
三个选中文件），scoped 静态层（含 task-contract-check strict-subset 于本任务 + 两个交叉任务文件）
全绿。

**AC3 + DoD 证据（外层验证轮交付）**：`state: green` 于 **08:56 / 10:08 / 11:49 三轮连续**（
`/home/yale/work/quay/.quay/full-suite-state.json`），11:49 轮 11:49→12:04（868996ms）三段 TAP 全绿
（main 2792 / serial 42 / lowconc 186），**Promise-pending 0 / 切断标记 0 / cancelled 0** ⇒
101→0 失败数最终确认，判绿三条件的 `cancelled 0` 成立、`FULL-SUITE-EXIT` 已不再输出（runner
state:green 即 exit-0 等价）。DoD 两项（干净窗口重跑 + 连跑 2 次全绿）均由外层验证轮达成。
