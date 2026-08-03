# 外层编排 loop tick 指令

**启动方式**（在编排会话，即本会话或 `/clear` 后的新会话）：

```
/loop 20m 执行 orchestration/orchestrator-loop-tick.md 中的 tick 指令
```

---

## 冷启动（新会话 / `/clear` 后的空上下文）

**按顺序做完这 7 步再进 tick 步骤。** 不要凭记忆——你没有记忆。

```bash
cd /home/yale/work/quay
```

**1. 读机制与目标**（顺序有意）

| 文件 | 得到什么 |
|---|---|
| 本文件其余部分 | 外层的职责、授权边界、tick 步骤 |
| `orchestration/exp6-phase1-sustained-unattended-operation.md` | 目标、20 条 AC、DoD、四项已定决策 |
| `orchestration/tick-log.md` | **历史 tick 与动作类型累计分布**——退化判据的唯一来源 |
| `orchestration/escalations.md` | 已攒给人、尚未处理的非常规项 |
| `docs/analysis/batch2-queue-state.md` | 内层自报的队列状态（**可能是旧快照，以 git 为准**） |
| `adr/ADR-021-adaptive-budget-self-regulating-methodology.md` | 四项原则 |

**2. 建立实况**（以实测为准，不以上面任何文件的自述为准）

```bash
git log --oneline -10 && git status --short
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
```

**3. 找到内层会话**

```bash
tmux list-sessions && tmux list-panes -a -F "#{session_name}:#{window_index}.#{pane_index} #{pane_current_path}"
```

内层是 `cwd` 为 `/home/yale/work/quay` 且**不是你自己**的那个 pane（历史上是 `quay-0:0.0`；用
`tmux capture-pane -p -t <target> | tail -20` 确认它在跑开发任务而非编排）。找不到就升级给人。

**4. 重建 cron —— 这一步最容易漏**

`CronCreate` 的任务是**会话内的**，会话一结束就没了。新会话必须重建，否则外层再也不会自动触发：

```
CronCreate(cron="*/20 * * * *", prompt="执行 orchestration/orchestrator-loop-tick.md 中的 tick 指令", recurring=true)
```

**4a. `/loop` 是跨 `/clear`/`/compact` 的行为稳定层，不是驱动器**

两层都一样。主推进信号是后台 agent 的完成通知；`/loop` 的作用是**上下文被清空后，仍有东西把
tick 指令重新调起来**——tick 文件的「冷启动」一节正是为这一刻写的。

**今天有现成的证据**：2026-08-02 16:14Z 内层被 `/clear`，新会话只有 5 行上下文，而它当时**没有
运行中的 `/loop`**，于是恢复全靠外层手工简报。若有固定间隔的 loop，它会自行触发并读到冷启动一节，
按设计自恢复——这正是这个机制存在的理由，而它当时不在。

**必须用固定间隔形式**（`/loop 25m <prompt>`）：不带间隔的动态模式走 `ScheduleWakeup`，
**没有任何列出工具**，即「这个循环是否还活着」无法查询。对一个专门用来在上下文丢失后兜底的机制，
不可查验等于不可信——你无法在需要它之前知道它还在不在。

**4b. 重挂 Monitor —— 和 cron 一样是会话内的**

`Monitor` 与 `CronCreate` 同样活不过会话。新会话必须重挂，否则外层退回纯 20 分钟轮询：

```
Monitor({command: "/home/yale/work/quay/orchestration/watch/inner-state.sh",
         description: "内层状态转变", persistent: true, timeout_ms: 3600000})
```

**5. 核对前置条件**

`.halt` 是否还在、套件是否绿、内层 loop 是否已启动。见目标任务的 AC1–AC6。

**6. 补记一次 tick**

冷启动本身算一次 tick，动作类型通常是 `no-action`（只是恢复）或 `unblock`（恢复时发现内层停摆）。
在 `tick-log.md` 记一行，注明「冷启动恢复」。

**7. 进入正常 tick 步骤**

## 定位

双层持续开发的**外层**。内层是开发会话（tmux `quay-0:0.0`），它执行任务；外层观察它、消解它的停摆、
必要时纠偏，并把真正需要人的事攒起来。

**外层存在的唯一理由：消费内层的停止条件。** 内层撞到「合并冲突 / 套件红 / 审查 2 轮后仍 REFUTED /
超 90 分钟 / needs-human 积压 ≥3」就停下等人——外层就是那个「人」的常规部分。内层仍然停，只是停的
时长从「到人回来」变成「到下一个 20 分钟 tick」。

## 授权边界（已与人约定，不可自行放宽）

| 外层可以 | 外层不可以 |
|---|---|
| 解阻塞（回退、bisect、判断发现真伪、分诊积压） | **直接改代码** |
| 重排队列、补建任务、纠正错误前提 | 改变方向或范围 |
| 写 `orchestration/`、队列状态文件、`tasks/*.md`（见下） | 写 `packages/` `plugin/` `experiments/` 下的**实现与测试** |
| 给内层下指令 | 替内层执行 |

**`tasks/` 的归属（2026-08-02 消歧）**：本表原先同时写着「可以补建任务」和「不可以写 `tasks/`」，
自相矛盾。裁定：**`tasks/*.md` 是队列，不是代码——外层可以写**（建任务、改状态、调优先级）。
单一写入者纪律要保护的是工作树里的实现代码，不是队列本身。

唯一约束：**写 `tasks/` 前先确认没有在飞任务把 `tasks/` 列进它的 `## Touches`**，否则会和内层
撞车（`grep -l '^## Touches' -A20` 查在飞任务，或直接看遥测 `inProgress`）。撞上就改为「记进队列
状态文件 + 指示内层建」。

**外层不直接改代码**——它下指令，内层执行。理由：保持单一写入者。本会话 2026-08-02 有过一次
`git stash` 事故，正是外层动了内层正在工作的树。

人在，但不需要被打扰：**常规自行处理，非常规攒起来**等人有空看。

## Tick 步骤

### 0. 三个已经害过我们的失败模式

这三个都发生过，都表现为「内层看起来在工作」，都不会自己暴露：

**a) 内层输入框里的字大概率不是待提交的指令，是 ghost suggestion。** 2026-08-02，外层看到内层
`✻ Cogitated for 41m 47s` + 输入框里有一行字，判定为「指令掉了 Enter」——错的。那是 Claude Code
自动生成的输入建议（CLAUDE.md 早已警告过 gray ghost-suggestions），内层其实是**问完问题正常结束
了回合，在等人答复**。

两个后果：

- **停摆分类不要靠输入框内容猜。** 内层结束回合等答复，就是外层存在的理由本身（步骤 3），
  不是故障。看最后一段 `⏺` 输出问了什么，直接答。
- **发指令前必须 `C-u`**，因为输入框里可能有 ghost 文本。CLAUDE.md 的可靠发法是
  **`C-u` → 文本 → `Enter` 三次分开调用**（合并会丢 Enter）。发完 `capture-pane` 确认出现了新的
  `⏺` 输出——未确认送达的指令等于没发。

**b) 判断内层是否停摆要看「屏幕是否在变」，不是看最后一行。**

```bash
tmux capture-pane -p -t quay-0:0.0 | md5sum; sleep 25
tmux capture-pane -p -t quay-0:0.0 | md5sum      # 两次相同 = 空闲
```

**c) 外层的独立核实会和内层抢 CPU。** 步骤 1 写着「只读」，但跑一次全量套件是 **9 分钟的 8 路满载**，
足以把内层 `select-preflight` 那种 timeout 余量只有 8% 的测试压成 flaky。规则：**全量套件只在内层
确认空闲时跑，且跑完再叫醒内层**；内层在飞时只核实便宜的声称（文件存在、grep 计数、单文件测试）。

**d) cron 只在本会话空闲时触发。** 外层正在和人对话时，`*/20` 的 tick 不会 fire。人机对话期间外层
事实上是停的——所以**每次对话结束前手动补一次 tick**，不要假设 cron 会接上。

### 0b. 事件式监测（Monitor）——补 tick 之间的盲区

20 分钟 tick 的盲区是**内层停摆后的等待时间**。`orchestration/watch/inner-state.sh` 只在**状态
转变**时发声，挂成 `persistent` Monitor：

| 事件 | 含义 |
|---|---|
| `IDLE` | 在飞任务清空 —— 内层可能在等裁定 |
| `START` | 在飞集合变化 —— 新一批开工 |
| `OVER90` | 单任务超 90 分钟 —— 内层自己的停摆阈值 |
| `ORPHAN` | 有 `--task-start` 无 `--task-end` |
| `RISKY` | master 出现 revert / `--ours` / `--theirs` / force 类提交 |

**它买什么、不买什么**（2026-08-02 实测得出，别搞混）：

- **买的是死时间**。它把「内层停下等裁定」到「外层发现」的延迟从最多 20 分钟压到 ~1 分钟
- **不买纠偏质量**。同期四次 `correct` 没有一次是延迟受限的——它们受限于视角，见步骤 2 的
  「外层的价值来自视角」。**更快的监测不会让外层看得更准**

**代理信号迟早会误报，能换成结构信号就换。** 2026-08-02 一天里五个检测信号误报，五次的根因是同一个：
**测的东西和声称的东西不是一回事**。

| 检测器 | 代理信号（错） | 结构信号（对） |
|---|---|---|
| `RISKY` | 提交消息里有 "revert" 字样 | body 里 git 自己写的 `This reverts commit` |
| `STALLED` | 遥测 `inProgress` 是否为空 | **正在运行的 `node --test` 进程数** |
| 全量套件分类 | 命令文本里提到 `test.sh` | `test.sh` 出现在命令位置（剥离引号内容后） |
| `--clean-stale` 安全性 | 提交数为 0 | 提交数 0 **且**两点 diff 为空 **且** worktree 无未提交改动 |
| `START` | 首次轮询就当作转变 | 首次标 `INIT`，只有真转变才 `START` |

`STALLED` 那条的具体教训：**合并与验证跑不在任务括号内**，遥测 `inProgress` 为空，于是两级判据
退化成 90 秒阈值直接误报——而当时内层正跑着 11 个 `node --test` 进程。数进程比问遥测更直接，
且不依赖内层是否记了计量。

**核实「修好了没有」要看行为或读 diff，不要 grep 关键词。** 2026-08-02 第三次：为核实
`flags-only` 修复是否落地，grep 了 `flags-only` 与 `selected .* files`，两处都命中——**但命中的是
缺陷本身**：`flags-only` 命中脚本头部那句错误的承诺（第 25 行），`selected N files` 命中 `--for-task`
的两条既有错误消息。修复其实根本还没合并。

**根因是结构性的：描述一个缺陷的词，必然出现在这个缺陷自己的文档里。**
**镜像同样成立**（2026-08-03 第六次实证）：核实 `relation-sync` 是否已把 `process.exit(1)` 改掉，
grep 得到 **4 处命中**——**全是注释**，内容正是「为什么 `process.exit(1)` 是错的、已改成
`process.exitCode`」。**修复的说明里必然写着缺陷的名字。** 所以无论查「缺陷还在不在」还是
「修复到位没有」，grep 关键词都会给出反向答案。 所以 grep 这些词找到的是
缺陷，不是修复。判据只能是**行为**（同一调用的测试数是否相等）或**读实际 diff**。

**这条规则也管外层自己的临时诊断，不只管检测器。** 2026-08-02 第六次踩同一个坑，就在 tick 观察里：
用 `pgrep -c -f 'scripts/test.sh'` 数并发套件，得到 3 且「在上涨」，几乎据此向人报告「内层没执行
串行指示」。实际是 **0 个真进程**——`pgrep -f` 匹配了任何命令行里含该字符串的进程，**包括外层自己
这条 tick 命令的 bash 包装**。同一分钟的 `node --test` 计数 4 也是同样的假象（`comm=node` 实为 0）。

真实情况是负载一路在回落：**16.62 → 12.26 → 7.28 → 4.33**，套件早就在陆续退出。

**Node 进程的 `comm` 是 `node-MainThread`，不是 `node`。** 2026-08-02 查明这是外层一整天进程计数
出错的总根因：`ps -e -o comm= | grep -cx node` **永远返回 0**，而我用它当作「没有东西在跑」的证据
判过停摆。一整天在两个坏方法之间摇摆——`pgrep -f` 匹配命令行散文（多计，把自己的 tick 命令算进去），
`comm=node` 永不匹配（少计到零）。**正确写法**：

```bash
ps -e -o comm= | grep -cx node-MainThread     # 或 pgrep -xc node
cut -d' ' -f1 /proc/loadavg                    # 负载是独立且不会说谎的第二判据
```

**判停摆要两个独立判据同时成立**（进程数为 0 **且** load1 < 1），单靠任一个都被骗过。

**数进程要么用 `comm` 精确匹配，要么显式排除自身**（`grep -v` 掉 `grep`/`ps`/`capture-pane`/
`claude`）。`pgrep -f` 的模糊匹配在一个「命令行里到处写着脚本名」的编排会话里是不可用的。

**新检测器的第一条事件，默认当作待验证，不当作发现。** 2026-08-02 挂了三个检测信号，
**三个的第一次发声都是误报**：

| 检测器 | 首次发声 | 真相 |
|---|---|---|
| `RISKY` | 外层自己一条提交 | 匹配的是提交消息里的 "reverting" 一词，不是提交做了什么 |
| `STALLED` | 内层「已静止」 | 它在等自己派的 subagent，不是在等裁定 |
| `START` | 「在飞任务变为…」 | 挂载时的基线读数，不是转变（已改标 `INIT`） |

三次都是同一个毛病：**信号看起来对，但它测的东西和它声称的东西不是一回事**。所以收到任何
检测器的第一条事件时，先跑一次能证伪它的检查，确认它测的确实是它声称的；确认之前不要据此行动，
也不要写进 tick 记录当作发现。

**已知盲区**：`IDLE` 只是「无在飞任务」的代理，不是内层真的在等裁定。修复类工作（如 M243 抢救）
跑在 `--task-start`/`--task-end` 之外，遥测看不见，此时内层在忙而信号显示 IDLE。真正的信号要内层
主动写——见 [[gap-no-explicit-blocked-signal-from-inner-layer]]。

### 0c. 派发闸口的清单与留痕：`## Contract` + `## Dispatch review`（外层，gap-dispatch-gate-has-no-checklist-and-no-trace）

外层对派发任务的审查此前是**惯例**——四次介入里两次靠外层碰巧拥有的上下文（`=` 拼写、`duration_ms`
口径），没有清单、没有留痕。现在变成任务创建时写下的、机器能消费的声明，外层在**派发前**消费它：

**派发前对每个候选**，读它的 `## Contract` 块（六个键：`measure`/`band`/`invariant`/`invoke`/`control`/
`resume`；`n/a: <理由>` 合法、留白不是），并跑消费者检查器：

```bash
node --experimental-strip-types plugin/scripts/task-contract-check.ts --root <repo> --json
```

- 五条消费者判定（AC 阈值→measure/band 引用、measure 命令+字段、invoke 反引号命令+done 证据逐字、
  defect→control、键空值）；**读内容不只验存在**，按代码/字段位置匹配
- **报出而不阻断**；违规名单 `docs/analysis/contract-violations.md` 只能变短（新增违规检查器退出 1）
- 这里就是「审查问了什么」的机器承载——**留痕**由任务体的 `## Dispatch review` 段承载
  （`reviewer: outer|none` / `at: <ISO>` / `changed: <逐条|无>`），外层介入后把改了什么写进去；
  `reviewer: none` 合法，但「没过闸」必须是被记录的选择

**不做**：不引入审查 agent、不加轮次、不阻断派发、不恢复 prepare 管线。把「碰巧」变成
「写下来时就被问到」——如果 `## Contract` 没有真读它的消费者，三天后它就是第五段散文。

### 1. 观察（只读，不动手）

```bash
tmux capture-pane -p -t quay-0:0.0 | tail -20      # 内层在做什么
git -C /home/yale/work/quay log --oneline -10       # 落地了什么
git -C /home/yale/work/quay status --short          # 树是否干净
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
cat docs/analysis/batch2-queue-state.md             # 内层自报的队列状态
```

**以 git 和实测为准，不以内层的自述为准。** 内层报告过「AC9 满足」而实测 627s 超限；报告过任务
done 而 DoD 未勾。每个 tick 都要独立核实至少一项它声称完成的事。

**核实优先查 transcript，不要靠重跑。** 重跑一次全量套件是 8 分钟 + 8 路满载，还会把内层的
timeout 余量压成 flaky（步骤 0c）。查 transcript 是秒级、零干扰：

```bash
node orchestration/watch/inner-forensics.mjs verify 全量套件 --since <上次 tick 的 ISO 时刻>
node orchestration/watch/inner-forensics.mjs timecost --since <外层 loop 起点或本班次起点>
```

`verify` 接**类别**（`全量套件` / `范围化测试` / `其它 Bash`，与 `timecost` 同源，不会分歧）
或任意正则。它列出每次调用的时刻、真实耗时、命令——内层声称「跑了全量套件」是真是假，一眼可判。

**零命中不等于「内层没做过」**，它与「查询写错了」不可区分。工具会自己提示这一点：先用类别形式
复核，确认查询正确后零命中才是证据。这条是实测出来的——自检时手写正则得 0 命中，而同一份数据
`timecost` 报 8 次。

`timecost` 给出空转 / 全量套件 / 范围化测试 / 其它 / 生成的分解，是判断「该修延迟还是该修测试」
的唯一依据（见 `orchestration/throughput-decomposition.md`）。**注意窗口**：分析外层的影响必须
`--since` 外层 loop 起点，否则会把 loop 之前的空转算到外层头上。

**`/clear` 会切断历史。** 内层被 `/clear` 后会新建会话文件，工具的 auto-pick 只拿到最新那个。
请求窗口早于它首条记录时，工具会打印 `⚠ … 个更早的会话未被包含`，并给出 `--session <id>`。
**看到那条警告就说明本次输出不是完整窗口**——跨 `/clear` 的分析要逐个会话跑再合并。

### 2. 分类本 tick 的动作

**必须**记录本 tick 属于哪一类——这是判断分层是否退化的唯一依据：

| 类型 | 含义 |
|---|---|
| `no-action` | 内层正常推进，无需介入 |
| `unblock` | 内层停摆，外层消解后恢复 |
| `correct` | 内层在推进但方向/做法有问题，纠偏 |
| `escalate` | 超出授权，攒给人 |

**退化判据**：若多数 tick 是 `correct`，说明内层自主性不足——**该修内层，不是加密外层频率**。
若多数是 `no-action`，分层是对的。

### 外层的价值来自视角，不是来自更聪明（2026-08-02 记录）

跑满一轮后（13 个 tick：`no-action` 4 / `unblock` 3 / `correct` 4 / `escalate` 2），四次 `correct`
的共同点**不是外层想得更深**，而是：

- **外层对「这个任务完成」没有利害关系**。内层在一件事上投入 1 小时后，倾向于接受让它变绿的解释；
  外层没有那个沉没成本
- **决定性的那一步都很便宜**。最大的一次纠偏（负控制也在失败 ⇒ 是 runner 单点故障，不是 14 个
  陈旧 fixture）只需要单独跑一个测试文件、读一遍测试名。**不是难的推理，是没人在赶工时会做的推理**

**因此不要把外层当成「更强的模型来兜底」。** 外层同期也犯了同一类错误：只查 master 工作树就断定
A2/A5「从未落地」（实际在分支上）、分类器漏掉多行 import、`-E` 模式下写 `\|`。**更强的模型减少
不了这类错误，换个视角才能。**

**这条直接决定了两件事**：（a）`correct` 占比升高时该修内层的判据（上面那条），而不是给外层加
算力；（b）阶段 2 产品化时，双层机制的卖点应写成**独立视角 + 无沉没成本**，而不是「用更大的模型
监督小模型」——后者会把一个结构性优势误说成算力优势。

### 3. 按内层的停摆原因消解

| 内层停在 | 外层做什么 |
|---|---|
| 合并冲突 | 读两边意图，指示内层回退或修复。**不自己 merge** |
| 全量 suite 非绿 | bisect 定位；判断新引入还是既有；既有的指示建任务，新引入的指示回退 |
| 审查 2 轮仍 REFUTED | 读审查发现，判断是否真实。真实 → 指示缩小范围重做；不实 → 指示记录理由后推进 |
| 任务超 90 分钟 | 判断是任务过大（指示拆分）还是卡住（指示放弃并建任务记录） |
| needs-human 积压 ≥3 | 分诊：真阻塞的攒给人，可继续的指示内层继续 |
| 就绪队列为空 | 从任务库补一批（见步骤 4） |

### 4. 队列补充

队列空时，从 `tasks/` 取下一批。**复用已有机制，不新建**：

- 候选：`status: todo` 或 `ready` 且带 `milestone-candidate` 标签
- 依赖就绪：父任务 done、无未满足前置（`it0-split-or-commit-check.ts` 的 PARENT-DONE-IFF-CHILDREN）
- 并发资格：`checkTouchesPair`（`plugin/scripts/touches-orthogonality-check.ts`）对**所有在飞任务
  和彼此**两两检查，重叠则不同批
- 优先级：阻塞其它任务的优先；`gap-*` 缺陷类优先于 `DIR-*` 新能力

把补充结果写进队列状态文件，指示内层派发。

### 5. 升级（攒起来，不打扰）

以下**不自行决定**，写进 `orchestration/escalations.md` 等人：

- 同一失败在外层消解后**再次出现**——循环不收敛，不是单点故障
- 需要改变**方向或范围**的决定（不只是解阻塞）
- 外层自己的停止条件触发（见步骤 7）

每条升级要写：现象、外层已尝试什么、为什么超出授权、建议的两个以上选项。

### 6. 学习：更新目标与方法的描述

**每个 tick 都要问**：这一轮看到的东西，是否改变了我们对目标或方法的理解？

若是，更新对应文件并提交：

- `orchestration/exp6-phase1-sustained-unattended-operation.md` —— 目标、AC、DoD 的修正
- `docs/analysis/fast-mode-loop-tick.md` —— 内层机制的修正
- 本文件 —— 外层机制的修正

**这是机制的一部分，不是可选项。** 本会话已多次出现「前提错了才发现」（`extractMechanismClaims`
不在拆分决策路径上、416s 上限设在不知成本结构时、readiness check 不查套件）。不写下来，下一个
tick 或 `/clear` 后的会话会重犯。

修正时**必须写明是什么证据推翻了原判断**，不只是改结论。

### 7. 外层自己的停止条件

**连续 3 个 tick 没有推进任何任务状态** → 停止 loop，叫人，附上三次 tick 各自看到了什么。

「推进」的定义：有任务状态变化、有 commit 落地、或有升级项产生。三次都是 `no-action` 且内层无进展
= 系统卡住了，不是在正常工作。

### 8. 写回并重新排程

**时刻必须来自 `date -u`，不许估。** 2026-08-02 审计发现 tick-log 的时间列是手写猜测的，
早期几条偏了近 **4 小时**且是**未来时刻**（写 `~20:10Z` 而真实是 15:46Z），导致时间列非单调、
整列不可信——而它正是退化判据的依据。已按 git 提交时刻整体重建。

同一个错也让一次取证查询查了未来时刻（`--since 17:30Z` 而当时 UTC 是 17:24），得到「窗口内无数据」，
与「选错会话」不可区分。**写任何时刻前先跑 `date -u`。**

- 更新 `orchestration/tick-log.md`：时刻（`date -u '+%H:%MZ'`）、动作类型、做了什么、内层状态快照
- **写完必须验证写进去了。** 2026-08-02 发现 **9 条 tick 记录静默丢失**：用
  `str.replace(锚点, 新行 + 锚点, 1)` 插入，锚点不匹配时**不报错也不改动**，而随后的
  `git commit` 因为有别的改动（tick 文件、任务文件）照样成功——于是每次都以为记上了。
  锚点失配的成因是我按「上一条应该是什么时刻」构造锚点，而不是从文件里读。
  **规则**：插入前 `assert 锚点 in 文本`，插入后断言行数增加了预期条数。丢失的 9 条已按 git
  提交重建。
- **累计分布不要手工加减**——从行数重算。2026-08-02 发现手记的计数已漂到 33 而实际 24 行，
  而这张表正是退化判据的唯一依据。这与内层 tick 文件「全局量（文件数、测试数、组成员数）必须
  运行时计算，不得写成常量」是同一条规则，外层此前没有。重算命令写在该表上方。
- `ScheduleWakeup` 20 分钟（1200 秒）

## 每个 tick 必报

- 动作类型（`no-action` / `unblock` / `correct` / `escalate`）
- 独立核实了内层的哪一项声称，结果如何
- 内层在飞任务数与各自已运行时长
- 遥测当前：任务数、均耗时、`tasksPerHour`（吞吐 = 收尾数/墙钟窗口小时，带 `windowStart/End/Hours`；
  `serialEquivalentPerHour` = 旧 60/均耗时，与并发无关）
- 累计动作类型分布（退化判据）

不要只说「内层在跑」——没有这些，分层是否有效无法判定。

## 相关文件

| 文件 | 作用 |
|---|---|
| `orchestration/exp6-phase1-sustained-unattended-operation.md` | 目标、AC、DoD |
| `docs/analysis/fast-mode-loop-tick.md` | 内层 tick 指令 |
| `docs/analysis/batch2-queue-state.md` | 队列状态（内层写，外层读+补） |
| `orchestration/escalations.md` | 攒给人的非常规项 |
| `orchestration/tick-log.md` | 每 tick 记录 |
| `adr/ADR-021-*.md` | 四项原则 |
| `docs/proposals/exp6-queue-driven-concurrent-executor.md` §0 | 两阶段交付范围 |
