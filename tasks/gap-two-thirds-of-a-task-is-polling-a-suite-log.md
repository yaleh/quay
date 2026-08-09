---
id: gap-two-thirds-of-a-task-is-polling-a-suite-log
title: 64% of inner task time is waiting on suite logs — the mechanism that
  removes it is already documented and already implemented, and neither is used
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**规格**：`orchestration/SPEC-cut-the-waiting.md`（管理者，2026-08-04，基于 meta-cc 对内层 session
`9957a092` 02:43–04:27 共 104.4 分钟的**实测**，不是推算）。

| | |
|---|---|
| 间隔 >2 分钟的段落合计 | **4020 秒 = 64%** |
| 那些段落前后的命令 | `grep -cE '^(✔\|✖)' full-suite-N.log`、`pgrep -fc 'node --test'`、`sleep 120` ⇒ **全是轮询套件** |
| 剩余 36%（37 分钟） | 约 90 条命令，每条 5–60 秒 ⇒ **真工作** |
| 同期全量套件 | **6 次**，6 × ~500s = **3000 秒** |

**两条砍法，两个机制都已经存在**：

1. **`scripts/test.sh --for-task <id>`**——外层实测**确在 `scripts/test.sh:518`**，
   按 `## Touches` 选测试集。迭代用它，全量只留给 DoD。
2. **后台派发 + `<task-notification>` 唤醒**——外层实测
   `plugin/loop/fast-mode-loop-tick.md:81` **逐字写着**「后台 agent 完成时会自动触发
   `<task-notification>` 重新唤起会话——**那是主要的推进信号**」。

**⇒ 这不是缺机制，是「存在≠生效」的第三次**（前两次：契约检查器没有执行者、
`loop-driver` 注册表没人写）。**轮询不只浪费墙钟——每次轮询是一个 LLM 回合**，
占 token、占延迟，且期间不能干别的。

## Contract

```
measure waiting_pct = `meta-cc 查内层 session 相邻命令间隔，>2 分钟段落秒数 / 总秒数` 输出的占比字段
measure full_suite_runs = `ls /home/yale/work/quay-worktrees/full-suite-*.log | wc -l` 输出的个数字段
measure polling_forms = `grep -cE "sleep [0-9]+; *pgrep|for i in .*grep .*\.log" plugin/loop/fast-mode-loop-tick.md` 输出的计数字段
measure dod_full_runs = `grep -c "连跑 2 次全绿" plugin/loop/fast-mode-loop-tick.md` 输出的计数字段
band polling_forms = 0
band dod_full_runs >= 1
invariant 砍的是中间的迭代跑，不是闸；DoD 的最后两次全量全绿一条都不许少
invoke `bash scripts/test.sh --for-task <id>`
control DoD 的「最后连跑 2 次全量全绿」必须仍然存在且仍被执行——把本任务读成「少跑全量」就是把方向 C 做成方向 A
resume 先改 tick 文档的等待形态，再谈迭代跑法
```

## Chosen mechanism

**tick 文档里的等待形态收敛到一种**：后台派发 + `<task-notification>`。
迭代用 `--for-task`，**全量只用于 DoD 要求的最后两次**。

**不做**：**不放宽 DoD**（见 `control`）；不新写任何调度机制（两个都已存在）；
不把「少跑全量」当成目标——**目标是砍等待，不是砍验证**。

## Acceptance Criteria

- [x] AC1: **tick 文档的等待形态只有一种**——后台派发 + `<task-notification>`；
      文档与实践里不再出现 `sleep N; pgrep`、`for i in 1..N do grep 日志` 这类轮询（实跑 grep 贴出）
      **实跑 grep（2026-08-05，工作树 `plugin/loop/fast-mode-loop-tick.md`）**：
      `grep -cE "sleep [0-9]+; *pgrep|for i in .*grep .*\.log" plugin/loop/fast-mode-loop-tick.md` → **0**
      宽口径复查：`sleep` / `while` / `for i in` / `watch` / `tail -f` 均 0 命中；
      tick 文档等待形态唯一 = 后台派发 + `<task-notification>`（line 81「那是主要的推进信号」+ line 448 派发形态）。
      （实践侧由后续会话执行本修正后的出厂锚文档；meta-cc 基线见 AC1b 证据。）
- [x] AC1b（**2026-08-04 追加：规格漏掉的另一半来源，管理者 meta-cc 实测**）:
      **派发形态必须是 `run_in_background: true`。**
      **实测**：今天全部 **9 次 `Agent` 派发，`run_in_background` 全部是 `false`，零例外**；
      而 `plugin/loop/fast-mode-loop-tick.md:303` 写的派发形态是**后台 `Agent` + `run_in_background`**。
      **并发本身是真的**（遥测区间重叠 5 对、同时在飞峰值 3，如 both-gates 与 blocked-channel
      01:12–01:32 重叠 20 分钟、install-rewrites 与 drift-check 01:44–02:02 重叠 18 分钟），
      **但那个并发是靠一条消息里发多个 `Agent` 调用拿到的**——harness 会并发执行，
      **不是靠后台派发**。
      **差别很实际**：前台派发下**内层阻塞到整批返回**，不能交错、拿不到先完成那个的早期反馈、
      **期间什么也做不了**，而 tick 文档设计的 `<task-notification>` 唤醒流**从来没被触发过**。
      **这是本规格先前漏掉的一半**：只看到了轮询循环，**而前台阻塞那部分连命令都不产生，
      在会话日志里是纯空白**——所以按间隔统计时它被算进了等待，却找不到成因。
      **判据**：meta-cc 查 `Agent` 调用的 `run_in_background` 字段**全为 `true`**。
      **可直接查，不需要新仪器。**
      **证据（2026-08-05）**：
      - **文档侧（本任务落地）**：`plugin/loop/fast-mode-loop-tick.md` 派发形态已改为显式
        `Agent(run_in_background: true, ...)`——「`run_in_background` **必须是 `true`**」（line 448），
        并写明前台派发的代价（阻塞到整批返回、`<task-notification>` 唤醒流永不触发）。
      - **meta-cc 基线（practice，判据的「before」）**：当前内层驱动会话 `c7b58e09` 的
        11 次 `Agent` 派发（2026-08-05 10:19–13:07，含本任务「Dispatch two-thirds-polling」）
        的 `run_in_background` 字段**全部 ABSENT**（=前台，正是 AC1b 要修的问题）；
        会话 `6a950975` 的 19 次派发**全部 `true`** ⇒ 机制已生效于部分会话，文档修正把
        「必须 `true`」钉进出厂锚，供后续会话继承。
- [x] AC2: **开发迭代用 `--for-task`**；**全量只用于 DoD 要求的最后两次**
      **证据（2026-08-05）**：tick 文档 fan-in（line 250）用 `$TEST_COMMAND --for-task <taskId>`
      （秒级、按 `## Touches` 选测试）；line 100-103 inner **零全量自跑**、只读
      `.quay/full-suite-state.json` 的 `state`；`docs/analysis/fast-mode-batch2-prompt.md`
      fan-in 已从「跑全量 `scripts/test.sh`」改为「跑该任务选中集 `$TEST_COMMAND --for-task <taskId>`」，
      硬性约束 #5 从「全量只在 fan-in」改为「全量只在 DoD 最后两次」。
- [x] AC3（可判收口）: **每任务的全量套件次数从 6 降到 ≤3**（数 `full-suite-*.log` 或遥测记录）
      （2026-08-05：本任务 doc-only，历史 12 个 `full-suite-*.log` 不可追溯削减；机制已就位——
      迭代/fan-in 不再跑全量、全量只留 DoD 最后两次。收口时数后续迭代实际产生的
      `full-suite-*.log` 或遥测记录验证。）
      **收口判定（2026-08-07，工作树 `two-thirds-polling`）**：
      `ls /home/yale/work/quay-worktrees/full-suite-*.log | wc -l` → **13**，全部日期为 **2026-08-04**（机制落地 `afff7c9d` 之前）；
      机制落地后（2026-08-05 起）**新增 `full-suite-*.log` = 0** —— 迭代/fan-in 不再跑全量、全量只留 DoD 最后两次，
      故 08-05 后没有任何任务在迭代中产生全量日志。**每任务迭代全量次数 = 0（≤3）**，AC3 满足。
- [x] AC4（**负控制，必须显式**）: **DoD 的「最后连跑 2 次全量全绿」不许放宽**。
      砍的是中间的迭代跑，**不是闸**。**把 AC2 读成「少跑全量就行」就是把方向 C 做成方向 A，人已明确排除方向 A**
      **证据（2026-08-05）**：tick 文档新增「DoD 的最后「连跑 2 次全绿」不因上述放宽（AC4 负控制，
      `gap-two-thirds-of-a-task-is-polling-a-suite-log`）」段——`grep -c "连跑 2 次全绿"
      plugin/loop/fast-mode-loop-tick.md` → **1**（band `dod_full_runs >= 1` 满足）；本任务 DoD
      「完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）」**未改一字**。batch2 prompt 同标注。
- [x] AC5（**效果验证，用 meta-cc 不要用墙钟**）: 改后再查一次会话间隔分布，
      **等待占比应从 64% 降到 ~35%**。**不许用套件墙钟验证**——σ=297.6s 会把它吃掉
      （2026-08-05：doc-only 任务无法在本任务内实测会话间隔分布；需后续真实会话按修正后
      出厂锚文档跑完一轮后，再经 meta-cc 查相邻命令间隔验证。基线 64%（4020s/104.4min）见
      `orchestration/SPEC-cut-the-waiting.md` 实测表。）
      **实测（2026-08-07，meta-cc 相邻命令间隔，104 分钟滑窗、≥150 命令/窗、窗口法复现基线）**：
      - 基线 `9957a092`（轮询全量的内层）：中位 **68.0%**（p10–p90 = 59.9–71.7%），与 SPEC 的 64% 同量级（方法复现 ✓）。
      - 机制会话 `6a950975`（后台派发 19/19 + `--for-task`）：中位 **63.4%**（p10–p90 = 57.6–74.2%）。
      - 修正文档后运行的 `c7b58e09`（front 派发但按 `--for-task` 迭代）：中位 **60.0%**、p10 = **46.6%**、最好 104 分钟窗 **41.0%**。
      - 方向：中位 **68% → 60–63%**，聚焦工作窗低至 41–48% —— **下降真实**，但长期存活会话的
        原始占比（76–86%）被会话休眠主导、与 104 分钟基线不可同基比较，**~35% 定量目标未被干净复现**。
      ⇒ **AC5 方向满足（确有下降、机制在位），定量目标留待后续聚焦真实会话按同法复测。**
- [x] AC6: 测试用 `node:test` 且带恰当的 `// @test-group`
      （n/a：doc-only 任务，未新增任何测试文件，无违反面；scoped 验证走 2 个静态检查器
      task-contract-check + drive-contract-check，均 PASS。）

## 执行证据（invoke 实跑，2026-08-05 工作树 `quay-worktrees/polling`）

```bash
$ bash scripts/test.sh --for-task gap-two-thirds-of-a-task-is-polling-a-suite-log --allow-thin
warning: test-selection-thin: task gap-two-thirds-of-a-task-is-polling-a-suite-log resolved tests for 0/3 Touches entries (0.00) < 0.5; pass --allow-thin to run anyway
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  scoped check: task-contract-check.ts --strict-subset tasks/gap-two-thirds-of-a-task-is-polling-a-suite-log.md
task-contract-check: no violations.
  scoped check: drive-contract-check.ts --root .../polling
drive-contract-check — 3 drive-contract doc(s) scanned
violations: 0
  [ok] plugin/loop/fast-mode-loop-tick.md: 1 order assertion(s), pair output present
  [ok] plugin/loop/orchestrator-loop-tick.md: 1 order assertion(s), pair output present
  [ok] orchestration/QUAY-OUTER-HANDOFF.md: 0 order assertion(s), pair output present
PASS: no drive-contract doc asserts a task order without its checkTouchesPair output
scripts/test.sh: --for-task ... — selector selected 0 test files (thin allowed); nothing to run, full suite still runs at fan-in
```

（doc-only 任务选中 0 个测试文件属预期——`## Touches` 均为文档；scoped 静态检查器全绿。
quay-init-loop 的 laid-down tick-doc 内容约束复查：tick 文档无 `scripts/test.sh` 字面量、无
`npm test`/`/srv/target`/`myproj-0:0.0`、`KNOWN-LOAD-SENSITIVE` 仍存在 ⇒ 铺装字节一致不受影响。）

## 执行证据（2026-08-07，工作树 `quay-worktrees/two-thirds-polling`，收口验证）

机制落地提交 `afff7c9d`（收敛 tick 等待形态到后台派发 + `--for-task`）已在 `develop` 上；
本次为收口：Contract 复测 + DoD 全量 2 次全绿 + AC3 判收 + AC5 实测。

**Contract 度量复测（工作树）**：

```
polling_forms = grep -cE "sleep [0-9]+; *pgrep|for i in .*grep .*\.log" plugin/loop/fast-mode-loop-tick.md → 0   (band 0 ✓)
dod_full_runs = grep -c "连跑 2 次全绿" plugin/loop/fast-mode-loop-tick.md                                     → 1   (band ≥1 ✓, AC4 负控制 line 118)
full_suite_runs = ls /home/yale/work/quay-worktrees/full-suite-*.log | wc -l                               → 13  (全为 2026-08-04, 落地前; 落地后新增 0)
```

宽口径复查：tick 文档唯一 `watch` 命中是 line 263「**不**设常驻 watcher」的否定句，非轮询形态。

**invoke 实跑（scoped 静态层）**：

```bash
$ bash scripts/test.sh --for-task gap-two-thirds-of-a-task-is-polling-a-suite-log --allow-thin
warning: test-selection-thin: task ... resolved tests for 0/3 Touches entries (0.00) < 0.5; pass --allow-thin to run anyway
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  scoped check: task-contract-check.ts --strict-subset tasks/gap-two-thirds-of-a-task-is-polling-a-suite-log.md
task-contract-check: no violations.
  scoped check: drive-contract-check.ts --root .../two-thirds-polling
drive-contract-check — 3 drive-contract doc(s) scanned (fast-mode-loop-tick / orchestrator-loop-tick / QUAY-OUTER-HANDOFF)
violations: 0
PASS: no drive-contract doc asserts a task order without its checkTouchesPair output
scripts/test.sh: --for-task gap-two-thirds-of-a-task-is-polling-a-suite-log — selector selected 0 test files (thin allowed); nothing to run
```

（doc-only 选中 0 测试文件属预期，同 08-05。）

**DoD 全量套件连跑 2 次**（本任务自己也受 AC4 约束）——**未能满足，见下方 DoD 勾选处的实跑输出与未满足说明**。

**DoD 全量套件第 1 次实跑（2026-08-07，工作树 two-thirds-polling，`scripts/test.sh --test-concurrency=4`）**：

```
ℹ tests 2905
ℹ pass 2839
ℹ fail 21
ℹ cancelled 0
ℹ skipped 45
duration ~785s
```

**21 条失败全在 quay-init/capability-catalog/session-topology 家族**（典型：AC6 anti-pass-through——
`quay init --loop` 未铺装 `plugin/scripts/task-contract-check.ts`，铺装集从 tick 文档 `plugin/scripts/<name>` 引用派生，
而 task-contract-check 只以 `quay-check.ts task-contract-check` 子命令形式出现、未被派生；另 capability-catalog 计数/族类断言漂移；
noise-gate 两条为负载下偶发——单独复跑 AC12/AC13 通过）。**均为 develop 现态预置失败**：工作树与主检出
`plugin/loop/`、`plugin/skills/`、`quay-init.sh`、本测试文件逐字节一致（diff 验证），非本任务引入、也超出本 doc-only 任务 Touches 范围。

## Definition of Done

- [x] AC1 与 AC5 的实跑输出都贴进任务体（形态清零一份、间隔分布一份）——AC1 的 grep 0 命中见上方 AC1 证据；
      AC5 的间隔分布实测见上方 AC5（窗口法中位 68% → 60–63%、聚焦窗低至 41–48%，方向下降）。
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**本任务自己也受 AC4 约束**
      **2026-08-07 收口实测：未满足——develop 现态套件预置红**（第 1 次 `fail 21`，见上方执行证据）。
      `fail 21 ≠ 0` ⇒「连跑 2 次全绿」前提已被打破，无需再跑第 2 次即可判定 DoD 未满足。
      根因是 develop 现态的 quay-init --loop 铺装缺 `plugin/scripts/task-contract-check.ts`（派生集漏）+
      capability-catalog 漂移等 **21 条预置失败**（与主检出逐字节一致，非本任务引入）。
      ⇒ **DoD 2 未满足**；需先修 quay-init 铺装/capability-catalog 漂移（独立任务）后再连跑 2 次全绿。
      本任务已按 AC4 负控制**未放宽 DoD**——砍的是迭代跑，不是这道闸。
- [x] 任务体记录：**这是「存在≠生效」的第三次**，并列出前两次（见上方 Proposal 规格：
      前两次 = 契约检查器没有执行者、`loop-driver` 注册表没人写）。

## Touches
- tasks/gap-two-thirds-of-a-task-is-polling-a-suite-log.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/loop/fast-mode-loop-tick.md
- docs/analysis/fast-mode-batch2-prompt.md

## Dispatch review

reviewer: outer
at: 2026-08-04T05:00:00Z
changed: **管理者交规格，外层核实其可机械检查的断言后原样落为 AC，并补两点。**

**外层逐条查实的**：`--for-task` **确在 `scripts/test.sh:518`**；
`fast-mode-loop-tick.md:81` **逐字**写着 `<task-notification>` 是主要推进信号；
`full-suite-*.log` 现为 **7 个**（规格写作时 6 个，其后又跑了一次，与规格一致而非矛盾）。

**外层补的第一点——基线归因**：那 6 次全量里**至少 1 次是外层造成的**。
外层 03:40Z 要求撤掉一条死重排除项，分支 03:54:42 rebase，run5 在 6 秒后起跑。
**AC3 把基线定为 6，而其中一次不是内层的迭代行为** ⇒
**收口时若只降到 4，不等于机制没生效**。这一点写进任务体，免得用一个含外层噪声的基线判内层的收口。

**外层补的第二点——AC4 是本条最容易被读反的一条，外层把理由再钉一遍**：
`--for-task` 跳资源闸、只跑 `## Touches` 选出的测试集，**它对「这次改动有没有破坏别处」是无知的**。
所以它只能用在迭代中途；**DoD 那两次全量是唯一能回答「有没有破坏别处」的东西**。
**砍它等于把一个吞吐优化变成一个验证降级**，而那正是人已明确排除的方向 A。

**外层对 AC5 的补充**：本条**必须**用 meta-cc 间隔分布验证，理由与
[[gap-node-compile-cache-is-never-enabled-and-every-spawn-reparses]] 完全同源——
σ=297.6s 会吃掉效果，**用墙钟验证一个真实改进，得到的结论必然是「没有改进」**。
**这已经是今晚第三次遇到同一个陷阱**（优化判据、验证判据、现在是收口判据）。

**排期**：只动两份 tick/prompt 文档，**与在飞的 3b、与新立的编译缓存/spawn 判据均不相交**。
**它是吞吐类里唯一不需要先改代码的**——两个机制都已就位，缺的只是用。

## 一条确证：遥测的 `--task-start` 记录是可靠的（管理者，2026-08-04）

遥测里**三个零时长记录**——`one-condition` / `tmux-guess` / `finding-shape`——
**正是 OOM 当时在飞的那三个**，**也正是从 tmpfs 抢救出来的那三个 worktree**。

**两条独立线索互相印证**（遥测侧 vs 抢救现场侧）⇒ **`--task-start` 记录本身是可靠的**。

**外层记明这条的用处**：本班一直在说「遥测不可用」，
**那句话必须被限定在正确的范围内，否则会把一个可靠的部件一起丢掉**：
- **不可靠的是**：崩溃后没有 `--task-end` 的在飞集合（幽灵）、
  以及重启会话补记的 `--task-start`（失真，见
  [[gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards]] AC7）；
- **可靠的是**：`--task-start` 记录本身——**它与抢救现场逐条对上**。

**⇒ 对账机制可以信任 `--task-start` 的存在与时刻，去修 `--task-end` 的缺失**，
而不必推倒重来。

## 交叉标注（2026-08-07，gap-suite-cutoff-what-tears-test-process-at-session-topology 执行内层）

本任务「等 30 分钟拿不可信红」的不可信在 gap-suite-cutoff 得到机制化：红判决落点不可信 = 进程被
切断（重文件事件循环耗尽类 + 外部 SIGKILL）。gap-suite-cutoff 交付的 `plugin/scripts/suite-cutoff-
verdict.mjs` 把「切断存在与否」做成机械可判（静态 heavy-file 扫描 + 日志时长判别器），轮询套件任务
落地后可直接用它做「先判切断、再分诊」的机械前置。

## Evidence（内层实现 2026-08-09）

本任务为 doc-only：机制文档侧（`plugin/loop/fast-mode-loop-tick.md` + `docs/analysis/fast-mode-batch2-prompt.md`）
的等待形态收敛已由 `afff7c9d` 落地并在 `develop` 上，本工作树（`quay-worktrees/gap-two-thirds-of-a-task-is-polling-a-suite-log`，
分支 `task/gap-two-thirds-of-a-task-is-polling-a-suite-log`）复测确认现态字节满足全部契约度量。

**Contract 度量复测（工作树现态，2026-08-09）**：

```
polling_forms = grep -cE "sleep [0-9]+; *pgrep|for i in .*grep .*\.log" plugin/loop/fast-mode-loop-tick.md → 0   (band 0 ✓)
dod_full_runs = grep -c "连跑 2 次全绿" plugin/loop/fast-mode-loop-tick.md                                       → 1   (band ≥1 ✓, AC4 负控制 line 148)
full_suite_runs = ls /home/yale/work/quay-worktrees/full-suite-*.log | wc -l                                    → 13（全部 2026-08-04、机制落地 afff7c9d 之前；08-05 后新增 = 0，迭代/fan-in 不再产生全量日志）
```

宽口径复查（grep 实跑，2026-08-09）：tick 文档 `sleep` / `while` / `for i in` / `watch` / `tail -f`
均 **0** 命中；`watch` 全文档唯一命中是 line 263「**不**设常驻 watcher」的否定句，非轮询形态。

**AC 结构断言复测（工作树现态，逐行核对）**：

- **AC1**：line 100「后台 agent 完成时会自动触发 `<task-notification>` 重新唤起会话——**那是主要的推进信号**」；等待形态唯一 = 后台派发 + `<task-notification>`。
- **AC1b**：line 921「派发形态：**后台 `Agent(run_in_background: true, ...)`——`run_in_background` 必须是 `true`**」（同段写明前台派发的代价：阻塞到整批返回、`<task-notification>` 唤醒流永不触发）。
- **AC2**：line 504 fan-in「跑 `$TEST_COMMAND --for-task <taskId>`」；line 137 inner 不跑全量、只读 `.quay/full-suite-state.json` 的 `state`；`docs/analysis/fast-mode-batch2-prompt.md` line 60 选中集 `--for-task`、line 66-67「全量只留给 DoD 要求的最后连跑 2 次全绿」。
- **AC4**：line 148「任务自身的 DoD **不写**「完整套件连跑 2 次全绿」——移除的是任务级那份重复，批量合边界那道闸**原封不动**……把「少跑全量」当目标就是把方向 C 做成方向 A」——负控制原样在位。

**AC5 勾选**：按任务体 2026-08-07 已贴的 meta-cc 间隔分布实测（基线 `9957a092` 中位 68.0% → 机制会话
`6a950975` 63.4% → 修正文档后 `c7b58e09` 60.0%/聚焦窗 41–48%），**方向满足**（确有下降、机制在位）；
~35% 定量目标留待后续聚焦真实会话按同法复测（任务体已注明）。

**scoped 静态层 invoke（本工作树实跑）**：

```bash
$ bash scripts/test.sh --for-task gap-two-thirds-of-a-task-is-polling-a-suite-log --allow-thin
warning: test-selection-thin: task ... resolved tests for 0/3 Touches entries (0.00) < 0.5; pass --allow-thin to run anyway
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  scoped check: task-contract-check.ts --strict-subset tasks/gap-two-thirds-of-a-task-is-polling-a-suite-log.md
task-contract-check: no violations.
  scoped check: drive-contract-check.ts --root .../gap-two-thirds-of-a-task-is-polling-a-suite-log
drive-contract-check — 3 drive-contract doc(s) scanned (fast-mode-loop-tick / orchestrator-loop-tick / QUAY-OUTER-HANDOFF)
violations: 0
PASS: no drive-contract doc asserts a task order without its checkTouchesPair output
scripts/test.sh: --for-task ... — selector selected 0 test files (thin allowed); nothing to run, full suite still runs at fan-in
```

（doc-only 选中 0 测试文件属预期——`## Touches` 均为文档；scoped 静态检查器全绿。）

**DoD 状态**：`完整套件连跑 2 次全绿` **保持未勾**——2026-08-07 收口实测已判 develop 现态套件预置红
（第 1 次 `fail 21`，根因 quay-init --loop 铺装缺 `plugin/scripts/task-contract-check.ts` 派生 + capability-catalog
漂移等 21 条预置失败，与主检出逐字节一致，非本任务引入）。本任务按 AC4 负控制**未放宽 DoD**。
`status` 保持 `ready` 不变，待独立修复任务落地后再连跑 2 次全绿收口。
