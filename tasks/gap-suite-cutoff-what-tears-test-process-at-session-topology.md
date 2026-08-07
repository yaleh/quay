---
id: gap-suite-cutoff-what-tears-test-process-at-session-topology
title: "full-suite red verdict is UNRELIABLE: the test process was torn down
  mid-run (SIGKILL ×2, cancelled ×2, 'Promise resolution is still pending' ×35 →
  ~50 files each failing exactly 2× wholesale, not 34 broken tests) — the 101
  failures' landing points are meaningless; the real question is WHAT tore the
  process (at ~session-topology, alphabetically); hypothesis: OOM killer from
  the 160+ tmux-server leak consuming memory (same machine had a prior OOM);
  triage by failure-count would \"fix\" innocent files"
status: ready
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

- [ ] AC1: **切断源定位**——查明什么在 ~session-topology 把测试进程拆了（OOM killer / runner 清理 /
      测试冲突），贴出证据（dmesg OOM 时间戳 vs SIGKILL 时刻对照）
- [ ] AC2: **修掉切断源**——修复后干净窗口重跑，Promise-pending 级联不再出现
- [ ] AC3: **红判决可信恢复**——重跑后失败数显著下降（真失败 vs 级联噪声分离），且判绿三条件成立
- [ ] AC4: 与 `gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause`（tmux 泄漏——
      若 OOM 假设成立，切断是泄漏的下游后果）、`gap-two-thirds-of-a-task-is-polling-a-suite-log`
      （轮询套件任务的落地会砍掉「等 30 分钟拿不可信红」）交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体（含 dmesg/SIGKILL 对照）
- [ ] 干净窗口重跑 full-suite：Promise-pending 级联 0、真失败数可分诊
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- plugin/scripts/full-suite-runner.ts（若切断源在 runner 的清理/超时逻辑）
- scripts/test.sh（若测试进程生命周期管理需修）
- plugin/test/session-topology.test.mjs 附近（若切断由该测试触发——只查不预设）
- tasks/gap-suite-cutoff-what-tears-test-process-at-session-topology.md（自身文件）
- tasks/gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause.md（交叉标注）
- tasks/gap-two-thirds-of-a-task-is-polling-a-suite-log.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-07T04:1xZ
changed: 管理者 2026-08-07 分诊证据（整片切断 + Promise-pending + SIGKILL/cancelled）→ 外层立案：
  红判决落点不可信，真问题是切断源。主假设 OOM（tmux 泄漏下游），待验证。
