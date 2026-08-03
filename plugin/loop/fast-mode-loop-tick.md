# 快速模式 loop tick 指令

> **模板参数（gap-loop-mechanism-lives-outside-the-package-and-cannot-ship）**：本文件是随 quay
> 插件包分发的内层 tick 文档（`plugin/loop/`），本仓自身的循环直接读这份模板。`quay-init --loop`
> 铺到目标项目时对**副本**做机械替换，正文本体保持 quay 实值：
> - `/home/yale/work/quay` → 目标项目根（`--repo-root`）
> - `scripts/test.sh` → 目标项目测试命令（`--test-command`，必填）
> - `quay-0:0.0` → 目标项目 tmux 会话（`--tmux-session`）
> - `plugin/loop/fast-mode-loop-tick.md` / `plugin/loop/orchestrator-loop-tick.md`（本文件的
>   自引用/互引用）→ 目标项目的 `docs/analysis/fast-mode-loop-tick.md` /
>   `orchestration/orchestrator-loop-tick.md`
> 替换只作用于铺出的副本，不修改本模板。铺完后负控制：副本里 grep 不到 `scripts/test.sh` 这类
> quay 专属字面。

**这是一份 tick 指令，不是驱动器。** `/loop` 每次触发就执行一遍下面的步骤，然后重新排程。

<!--
标记约定（gap-dispatch-gate 的 Contract 机制之外，针对本文档自身的规范性语句）：
  unmechanized:   有意暂不机械化，附理由。是已声明的取舍，不是欠账，不要为它建检查
  unmechanizable: 本质不可机械化（思维纪律/判断题），只能靠每 tick 复读
未标记的规范性语句，默认应当有执行者——逐条审计见 docs/analysis/normative-prose-audit.md
-->

**这份文件必须能在 `/clear` 后的空上下文里独立启动。** 若你刚被清空上下文，按「冷启动」一节先建立
状态，再进入 tick 步骤。

**调用方式**（`.claude/loop.md` 已删除——exp5 退役；`/loop` 带显式 prompt 时不读该文件）：

```
/loop 25m 执行 plugin/loop/fast-mode-loop-tick.md 中的 tick 指令
```

**可查验性 / 为什么用固定间隔（2026-08-03，外层更正理由）**：`/loop` **不是驱动器**——主推进信号
仍然是后台 agent 的完成通知（见「定位：看护，不是调度」节）。`/loop` 的作用是**跨 `/clear` 和
`/compact` 保持行为稳定**：上下文被清空后，仍有东西把 tick 指令重新调起来，让你读到冷启动一节自行
恢复。可查验只是**次要收益**，不是目的。

- **带间隔**（`/loop 25m <prompt>`）走 **CronCreate**，可用 `CronList` 列出（返回
  `2312da21 — Every 25 minutes (recurring) [session-only]`）——**可查验**。
- **不带间隔**（`/loop <prompt>`）是动态模式，走 **ScheduleWakeup**，**没有任何列出工具**。
- **真正的理由**：对一个**专门用来在上下文丢失后兜底的机制，不可查验等于不可信**——你无法在
  需要它之前知道它是否还活着。今天 16:14Z 被 `/clear` 时没有运行中的 loop，恢复全靠外层手工简报，
  正是这个机制缺席的实证。
- **规则**：固定间隔（25 分钟，落在本文件第 6 步的 1200–1800 秒区间）。这也对阶段 2 产品化有意义——
  「动态排程连是否存在都无法查询」是「排程不能靠会话内 cron」之外的第二个产品化缺口。

---

## 冷启动（`/clear` 后的空上下文）

按顺序读这四份，然后从 tick 步骤 1 开始：

1. `docs/analysis/batch2-queue-state.md` —— 队列当前状态（已完成/在飞/待执行）
2. `orchestration/exp6-phase1-sustained-unattended-operation.md` —— 目标、AC、DoD
3. `adr/ADR-021-adaptive-budget-self-regulating-methodology.md` —— 四项原则
4. 本文件其余部分

再跑这三条建立实况（**以实测为准，不以队列文件为准**——它可能是 compact 前的旧快照）：

```bash
git log --oneline -10 && git status --short
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json
```

## 定位：看护，不是调度

exp6 §9 把 loop 降级为**跨会话行为稳定层**。这份 tick 兑现那个定位：

| loop 做 | loop 不做 |
|---|---|
| 会话 idle 时把停摆的队列推进一步 | 轮询后台 agent 是否完成 |
| compact / `/clear` 后从队列文件恢复状态 | 决定任务优先级 |
| 触发停止条件时停下并报告 | 替人做合并冲突/审查失败的判断 |

**后台 agent 完成时会自动触发 `<task-notification>` 重新唤起会话**——那是主要的推进信号。这个 tick 是**兜底心跳**，处理「会话 turn 结束了但队列还有活」的情况。因此间隔应长（20–30 分钟），不是快轮询。

<!-- unmechanizable: 判断题，无代码可强制。形态是启发式，靠每 tick 复读 -->
**不要把「没收到通知」当作「还在跑」（2026-08-02 两次停摆教训）**：后台 agent 会静默停止（transcript 静止、无 notify），尤其长测量任务。空闲时**先查进程再决定等不等**，别只依赖通知：
```bash
ps -e -o comm= | grep -cx node   # 0 = 没有 node 在跑
cat /proc/loadavg                # load1 < 1 = 无实质负载
```
两者满足 → 没有任何东西在跑，通知不会来了，**去核对产出/续跑**。每跑完一步就落盘（任务体/队列文件），不要攒到最后——即使 agent 静默停止，已落盘数据不丢，可从缺口续跑。

**跑全量前调用资源闸（机制，不是散文——`gap-no-resource-awareness-heavy-ops-run-blind`）**：
`scripts/test.sh` 已在默认全量路径接入 `bash plugin/scripts/resource-gate.sh --for full-suite`——WAIT 时
打印数字后退出非 0，**不静默等待**。手动跑全量同样先调 gate：退出码 0=GO 才跑，非 0=WAIT 不跑。
gate 读 `/proc/pressure/cpu` **`some avg10`**（结构信号：有任务在等 CPU 的比例；load 是代理，
claude 会话常驻使 load 永不降）、`free -m` available、`pgrep -xc node-MainThread`，并单列
ppid=1 且 cwd 已删除的孤儿 node 进程（AC10）。参考：本机 nproc=4，test.sh 默认并发已改为
**推导值 `max(1, floor(nproc / 2.1)) = 1`**（不再写死 8——8 worker + 子进程 = 17 进程、4.25× 超订，
是单套件的稳态不是并发的产物），`--test-concurrency=N` 显式传入永远优先。两层绝不同时跑全量套件。

**判绿三条件（2026-08-03，外层：fail 0 ≠ 绿）**：崩溃的套件也可能报 `fail 0`——batch4a 那次
`fail 0` 但 `cancelled 2`、`tests 2246`（非参考值 2361），两个重型测试被 cancelled
（'Promise resolution is still pending'）不计入 fail。**判绿必须三条同时成立**：
```bash
grep 'cancelled 0'   # cancelled == 0（cancelled 不计入 fail，必须显式查）
grep 'FULL-SUITE-EXIT=0'
grep 'tests 2039'    # tests 数等于参考值（2026-08-03 实测 2039；套件构成每次变都要重测参考值）
```
只查 fail 会把崩溃读成绿。reference `tests` 数演变：batch4b/4c 稳定 2361 → … → +14 resource-gate =
**判绿理由（2026-08-03 外层更正）**：cancelled 的成因**不是**「饥饿必然导致 cancelled」——sigma 高压负控制
（gate WAIT 41→99）仍 155/155 完整捕获、cancelled 未发生，推翻那个普适性。batch4a 的 cancelled 可能有
自身异步结构的触发条件（Promise 未决 + 事件循环已解决）。**判绿三条件成立的理由改为：「cancelled 是一种
会被 fail 0 掩盖的失败」——显式查它是为了不漏掉这种失败，不是因为饥饿必然产生它。**
2436（05:30）→ **retire 删除 18 个测试文件 = 2034**（05:45，155 files）→ **+stranded +parser = 2052**
（07:15，156 files）→ **+tmpdirs 测试隔离 R6 = 2054（08:40）→ **+token 重操令牌 = 2065**（09:05，token fan-in 套件实测）
参考值以最近一次全量绿的 tests 数为准。**注意 starvation 是单套件稳态（4 核跑 c8 = 4 倍过订，
压力 ~87）：全量只串行跑、起跑前调用资源闸（some avg10 < 40 才 GO），但套件自身跑起来压力必然 >40，
那是设计性超订不是异常。默认并发已改为推导值 max(1,floor(nproc/2.1))=1（4 核）；全量验证需显式
--test-concurrency=8，否则小时级**。

## 状态单一来源

`docs/analysis/batch2-queue-state.md`

每个 tick 结束**必须**写回该文件。它是 compact 后唯一可信的状态——不要靠记忆。

## 停止哨兵

`.halt`（仓库根）

exp5 已退役（`.claude/loop.md` 已删除），`.halt` 从「暂停 exp5 循环」改为**快速模式的唯一停止开关**。
存在即暂停；移除即放行。

移除前跑 `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`——
它检查工作树干净、无半途 merge、master 未被占用等硬条件。注意它有一条是「working tree clean」，
而快速模式下开发会话本就在 master 上工作，所以**在飞任务未落地时它会 FAIL 是预期的**，
不是故障；等在飞任务合并完、树干净了再移除。

---

## Tick 步骤

### 0. 哨兵

`.halt` 存在 → 本 tick 空转，报告「已暂停」，重新排程，结束。

### 1. 读状态

读队列文件。若与 `git log` / `git worktree list` 不一致，**以 git 为准**并修正文件——文件可能是 compact 前的旧快照。

### 2. Fan-in 已返回的任务（合并串行，全量套件批量）

**先逐个合并，再统一跑一次全量套件。**

对每个已返回但未合并的 subagent，逐个：

0. **先 rebase 到当前 master**：
   ```bash
   git -C /tmp/quay-wt-<slug> rebase master
   ```
   worktree 建立时对 master 取了快照，之后并发合并的其它任务它看不到。B3-2 就是这样红的——
   它的 worktree 建于 B3-1 合并前 13 分钟，于是对全局测试文件计数的断言过期。
   **并发窗口是并发模型固有的，不是偶发**，所以 rebase 是必需步骤不是可选优化。
   rebase 冲突 → 停止该任务的 fan-in，标 needs-human，报告；不要 `--skip`、不要 `-X ours`。
1. `git merge --no-ff task/<taskId>`
2. 冲突 → `git merge --abort`，标 needs-human，**停止本 tick 的后续合并与派发**，报告
3. 跑 `scripts/test.sh --for-task <taskId>`（该任务自己的选中集，秒级）
4. 选中集非绿 → 回退该 merge，标 needs-human，停止，报告

全部合并完成后，**跑一次**全量 `scripts/test.sh`：

5. 非绿 → **立即停止**，不再合并任何东西；逐个回退或 `git bisect` 定位是哪个 merge 导致，报告
6. 绿 → 对每个已合并任务：`git worktree remove` + `git branch -d`，关闭任务状态（AC 和 DoD 都勾；勾不上写理由或留 `ready`），记录耗时

**Land 时刻落盘汇总（必做，gap-telemetry-report-writes-and-deadlocks-readiness）**：全批合并 + 关闭完成后
跑一次显式 `--snapshot`，否则被 git 跟踪的聚合文件不会反映本批结果（`--report` 已是纯读、不落盘，
聚合只随 `--snapshot` 变化）：
```bash
node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --snapshot
```
落盘后随本 tick 的正常提交一起提交，**不要**为聚合单开「refresh telemetry aggregate」式提交。

**为什么批量：** 全量套件 ~7 分钟（418s 实测）。逐个合并各跑一次，3 个任务就是 21 分钟纯重复。批量后 7 分钟。B2/B3 这批 5 个任务在旧方式下花了约 35 分钟在重复跑同一套件上。

**不削弱任何断言**——合并仍逐个、每个仍有选中集把关、全量仍然跑，只是把全量的验证点从「每次合并」移到「一批合并」。红了用 bisect 定位，比省下的时间便宜。

**合并本身必须串行。** 并发合并会在共享工作树上撞车。

**worktree 隔离的传播代价（2026-08-03 观察）**：主检出的紧急修复**不会自动传播**到在飞任务的 worktree——
每个 worktree 有自己的 `scripts/test.sh` 等副本。这次是好事（隔离生效），但也意味着一个紧急修复要**显式同步
进每个在飞 worktree**（`cp scripts/test.sh /tmp/quay-wt-<slug>/scripts/test.sh`），否则在飞任务会继续用旧行为跑完
（实例：并发默认推导改为 1 后，主检出已修复回 8，但 sigma worktree 仍在串行跑 ~52 分钟）。派发/协调时要检查
在飞 worktree 是否有需要同步的主检出修复。

### 3. 检查停止条件

任一满足 → 不派发新任务，报告后重新排程：

- `.halt` 存在
- **窗口内新增** needs-human ≥ 3（2026-08-03 外层裁定：**不是总数**——历史积压不构成停止理由，
  它需要派发才能解开；意图是「产出 needs-human 的速度超过消解速度」。判据是**窗口内新增数**，
  不是仓库里 needs-human 的总数。分诊规则见 `plugin/loop/orchestrator-loop-tick.md` 步骤 3）
- 上一步全量 suite 非绿
- 有未解决的合并冲突
- 就绪队列为空

### 3.5 计量（强制，不可跳过）

派发前对每个任务：

```bash
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --task-start --taskId <id>
# 记下打印的 runId
```

fan-in 关闭任务时：

```bash
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts \
  --task-end --taskId <id> --runId <r> --outcome <done|needs-human|abandoned>
```

**这不是可选步骤。** 工具在 B2-1 造好并合并了，但截至 2026-08-02 11:08 `--report` 返回
`{tasks: [], tasksPerHour: 0}`——一次都没被调用过。所有耗时数字仍靠 commit 时间戳反推，
正是这个工具本该消除的考古。

没有计量，「1 任务/小时」无法判定，也无法知道任何优化是否真的有效。

### 4. 派发就绪任务（并发）

**并发上限 3 个在飞 subagent。** 并发是打破「外层变瓶颈」的手段——串行时外层的 20 分钟 tick 频率
会和任务完成频率同量级，分层退化成单层加延迟。

派发前对每个候选：

1. **依赖就绪**：父任务 done、无未满足前置。用 `it0-split-or-commit-check.ts` 的
   PARENT-DONE-IFF-CHILDREN 语义，不自己重新发明
2. **并发资格**：`checkTouchesPair`（`plugin/scripts/touches-orthogonality-check.ts`）对**所有在飞
   任务和彼此**两两检查

```bash
node --experimental-strip-types -e "
const R='$(pwd)'; const fs=await import('node:fs');
const m=await import(R+'/plugin/scripts/touches-orthogonality-check.ts');
const A=m.parseTouches(fs.readFileSync(R+'/tasks/<A>.md','utf8'));
const B=m.parseTouches(fs.readFileSync(R+'/tasks/<B>.md','utf8'));
const expand=(g)=>new Set(g.map(x=>m.normalizePath(x.replace(/ \(.*\)\$/,'').trim())));
console.log(m.checkTouchesPair(A,B,expand));
"
```

重叠 → 不同批，等下一 tick。**不要凭读 Touches 列表目测**——本会话有过目测判断被实测推翻的先例。

派发形态：后台 `Agent(run_in_background)`，subagent 自建 `/tmp/quay-wt-<slug>` worktree 和
`task/<id>` 分支，内部起独立对抗审查（硬上限 2 轮），只提交不合并。
`milestone-worktree.ts` **不可用**——它要求数字 M 号，gap 任务没有；用裸 `git worktree add`。

### 5. 写回状态

更新队列文件：已完成 / 在飞（含 worktree 路径和派发时刻）/ 待执行 / 计量表 / 本 tick 做了什么。

### 6. 重新排程

`ScheduleWakeup`，间隔 **1200–1800 秒**。理由：后台完成有 task-notification 自动唤起，这只是兜底。

---

## 无人值守期间的判断边界

以下**一律停下等人**，不要自行决定：

| 情况 | 动作 |
|---|---|
| 合并冲突 | abort，needs-human，停止派发 |
| 全量 suite 非绿 | 立即停，不再合并 |
| 对抗审查 2 轮后仍 REFUTED | 标 needs-human，停止该任务 |
| 任务超 90 分钟 | 中止 subagent，needs-human，不带内重试 |
| **窗口内新增** needs-human ≥3 | 停止派发新任务（2026-08-03 裁定：历史积压不构成——它们是范围决定不是解阻塞，升级给人） |
| 队列文件与 git 状态矛盾且无法判定 | 停，报告两边的实际内容 |

<!-- unmechanized: ADR-021 证据不足；覆盖上方「判断边界」表全部行。这不是欠账，是已声明的取舍——不要为它建检查 -->

这是**保守默认**。ADR-021 原则：不要在证据不足时把策略机械化。这些判断目前由人做，等积累了足够多的真实案例再考虑规则化。

## 阻塞信号：停下前写、恢复后删（强制，gap-no-explicit-blocked-signal-from-inner-layer）

2026-08-02 两次静默停摆（22:05、22:24）的根因是**内层停下时没有任何方式说出「我停下了、在等什么」**——
外层只能从缺席（TUI md5 / inProgress 空集）猜，而缺席信号会错。现在内层**主动写**一个存在性阻塞信号。

上面「判断边界」表里**每一个「停下等人」的动作，都必须先写阻塞信号再停，恢复后再清**：

```bash
# 停下前（任一停止/等裁定条件触发时）：
node --no-warnings --experimental-strip-types /home/yale/work/quay/plugin/scripts/inner-blocked-signal.ts \
  --assert-blocked --taskId <当前任务/阶段> \
  --reason <合法值见 `--schema`；不要照抄到这里，代码是唯一真源> \
  --question <要外层裁定的问题> [--options '<json>'] [--evidence '<json>']

# 恢复后（裁定下达、继续推进的那一刻）：
node --no-warnings --experimental-strip-types /home/yale/work/quay/plugin/scripts/inner-blocked-signal.ts --clear
```

规则：

- **文件存在 == 内层在等。** `--assert-blocked` 写在停下的那一刻，`--clear` 删在恢复的那一刻。这是
  存在性信号，不是从缺席推断。`plugin/scripts/inner-state.sh` 用 inotifywait 监视该路径（延迟秒级，
  不再是最多 20 分钟），事件直接带 `reason` + `question`，外层不必读屏就能开始判断。
- **不手写 JSON。** 只调 CLI（AC4）——`reason` 合法值就是「判断边界」表 + 停止条件里已有的七种，不新增
  语义（AC2，见 CLI `--schema`）。手写 JSON 会造成格式漂移，正是本机制要消灭的。
- **从 worktree 里也写主 checkout。** CLI 自动解析共享根（主 checkout）为落点——外层 Monitor 监视的是
  主 checkout 的 `.quay/`，且阻塞记录必须活得比产生它的 worktree 长。
- **等待时长由此可测。** `since` → 删除的时间差由 `--clear` 记进遥测；`fast-mode-telemetry --report`
  输出**累计死时间**与**单次最长**——「内层实际等了多久」这个数此前完全没有，现在有了基线。
- **un-halt 前** `restart-readiness-check.sh` 会打印阻塞记录（AC5）：内层在等裁定 ≠ 可以解除 `.halt`。

**本机制不让内层自动恢复**——内层仍然停、仍然等裁定，只是现在能说出自己停了（任务 DoD 明记）。

## 派发闸口的清单与留痕：`## Contract` + `## Dispatch review`（强制，gap-dispatch-gate-has-no-checklist-and-no-trace）

2026-08-02 的外层闸口介入是**惯例不是机制**——没有清单、没有留痕、没有触发条件。现在它变成
**任务创建时写下的、机器能消费的声明**。内层（本文件）与外层（orchestrator-loop-tick.md）都要执行：

**建任务时**（内层）：fast-mode 执行型任务应写一个 `## Contract` 块（`## Chosen mechanism` 之后），
六个键，每个都能指回一次真实介入，不预先扩充：

**格式硬约束：一行一个键，不可折行。** 折行的续行会被判 `contract-line-unknown`——
外层 2026-08-03 连踩两次（`gap-no-inventory`、`gap-quantified-stop-conditions`）。

```bash
## Contract

measure   suite_wall  = `scripts/test.sh` stdout 的 duration_ms 字段   # 单次墙钟，非 Σ 每文件
band      noise       = 20–63s（20000..63000 ms）                       # 实测基线
invariant selected_files = 163                                          # 变了则差异不可归因
invoke    `scripts/test.sh --test-concurrency=4`                        # 必须 `=`；空格形式走另一分支
control   把并发改回 8 ⇒ 判定必须不成立                                    # 负控制
resume    每跑完一次即写盘                                               # 中断保全
```

`n/a: <理由>` 是每个键的合法值；**留白不是**（留白与「没想过」不可区分，与 `reviewer: none` 同一条原则）。
`## Dispatch review` 段记录「谁审的、改了什么」（`reviewer: outer|none` / `at: <ISO>` / `changed: <逐条|无>`）；
`reviewer: none` 合法——不是每个任务都需要过闸，但「没过闸」必须是被记录的选择。

**派发前/关任务前**（外层）：跑消费者检查器，读**内容**不只验存在：

```bash
node --experimental-strip-types plugin/scripts/task-contract-check.ts --root <repo> [--json]
```

- 五条消费者判定：AC 阈值必须引用已声明的 measure/band 名；measure 必须同时含命令与字段名；
  invoke 必须反引号命令、done 任务证据逐字出现；defect 任务必须有 control；键空值报出
- **报出而不阻断**；违规名单是数据文件 `docs/analysis/contract-violations.md`，**只能变短**
  （检查器对新增违规退出 1，对既有违规只报不挡）
- 匹配按代码/字段位置（declared name / field token），不按文本——今晚 7 次「匹配到注释而非它本身」
  的教训

**不做**：不引入审查 agent、不加轮次、不阻断派发、不恢复 prepare 管线。

## 测试不得硬编码全局计数

`EXPECTED_ENGINE = 58` 这类断言在任何人新增一个测试文件时都会红。B3-2 的三个失败里有一个正是
如此——真实缺陷不是计数漂移，是**断言形态本身脆弱**。

全局量（文件数、测试数、组成员数）必须**运行时计算**，不得写成常量。断言可以是「product 组 +
engine 组 + governance 组 == 去重后 realpath 总数」这类**关系**，不能是「== 58」这类**快照**。

## 提出处置方案前，先跑那一条能证伪它的命令

上一条规则管的是**建任务**的门槛。这一条管的是**下结论**的门槛，两者是不同的漏洞。

2026-08-02 的四次外层纠偏全部是同一个形状：**结论比支撑它的证据强，而证伪它的命令只有一行、
只要几秒。**

| 内层的结论 | 一条命令就能证伪 | 实际是 |
|---|---|---|
| 「workflow-replay 12 个失败」 | 单独跑那个文件 | **14 个** |
| 「M243 与 master 有 schema-convention 冲突」 | `git show <merge> -- <那个 schema 文件>` | **空的**——那次合并根本没动它 |
| 「批量升格 expectations 到新约定即可」 | 看负控制是否也在失败 | `*-tampered (GREEN)` 也失败 ⇒ **是 runner 单点故障，不是 14 个陈旧 fixture** |
| 「AC9 满足」 | 实跑全量套件 | **627s，超限** |

<!-- unmechanizable: 思维纪律，无代码可强制。今晚由它挡住过一次掩盖式修复 -->
**规则**：在把一个处置方案写进队列状态文件或提交说明之前，先问「**如果我错了，哪一条命令会告诉
我？**」然后跑它，把输出贴出来。跑不出来的，方案里要写明这一条没被验证。

**特别地，当一个批量修复要改的是「期望值」而不是「实现」时，先找负控制。** 黄金语料、快照、
基线这类东西的全部价值就是钉住已观察到的行为——**改期望值让测试变绿，正是它们存在来防止的那件
事**。若负控制（故意制造的坏输入，应当被抓住）也在失败，那么在它恢复之前，任何期望值重写都不
合法，因为你无法区分「约定变了」和「检测器坏了」。

## 发现问题时建任务（有证据才建）

内层要能自己发现问题并建任务，否则 12 小时无人值守只会产出代码不产出待办。

**建任务的门槛：有可复现证据。** 三者之一即可：

- 一个失败的测试（贴出失败输出）
- 一个 grep/实测结果（贴出命令与输出）
- 一次真实运行的耗时或行为记录

**没有证据的观察不建任务**——记进队列状态文件的「待查」一节，等有证据再升格。这条是为了防止
12 小时产出十几个噪声任务。

建的任务必须有：`## Proposal`（问题 + 证据 + 选定机制）、`## Acceptance Criteria`（可机械验证）、
`## Touches`。缺任一项的不算建成。

**发现问题必须处置**：修，或建任务。**不要静音、不要降级后就走。** 本项目已有四次
「造了检测机制 → 它正确报警 → 警报无人处理」（RED 测试被改 skip、golden replay 被当预存失败、
clause-14 降为 advisory、既有失败记在已 done 的任务体里）。

## 每个 tick 必报

- 本 tick 合并了什么、派发了什么
- 在飞任务及其已运行时长
- 停止条件是否触发、触发了哪条
- 计量表当前行数与均值
- 遥测吞吐：`tasksPerHour`（= 收尾任务数 / 墙钟窗口小时，报 `windowStart`/`windowEnd`/`windowHours`
  ——2026-08-03 起口径由 `60/均耗时` 修正，旧量更名为 `serialEquivalentPerHour`，与并发无关）
- 阻塞信号状态（`.quay/inner-blocked.json` 存在与否；存在则报 `reason` + `question`，以及
  `fast-mode-telemetry --report` 的累计死时间/单次最长——2026-08-03 起该数有基线）

不要只说「继续中」——没有这些数字，1 任务/小时的目标无法判定。
