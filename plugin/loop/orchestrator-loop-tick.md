# 外层编排 loop tick 指令

> **模板参数（gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them）**：本文件是随
> quay 插件包分发的外层 tick 文档（模板在 `plugin/loop/orchestrator-loop-tick.md`，内层模板是
> `plugin/loop/fast-mode-loop-tick.md`）。
> `quay-init --loop` **原样铺出**（字节相同，不做文本替换）——目标项目的值（`repo_root` /
> `test_command` / `tmux_session`）集中在一个配置文件 `.quay/config.yml` 的 `loop:` 节里，
> 脚本与本 tick 在**运行时读取**它们，不在落地时烘焙。铺到目标项目时的位置：
> `orchestration/orchestrator-loop-tick.md`（外层）/ `docs/analysis/fast-mode-loop-tick.md`（内层）。
> 模板正文本体不含任何具体仓库路径、测试命令或 tmux 会话字面量。
>
> **目标项目值引用约定**：`REPO_ROOT` / `TEST_COMMAND` / `TMUX_SESSION` 三个名字在本文件中
> 指 `.quay/config.yml` `loop:` 节的对应值（`repo_root` / `test_command` / `tmux_session`）。
> 执行含这些名字的命令前，先读该文件把值代入——不要凭记忆。

**启动方式**（在编排会话，即本会话或 `/clear` 后的新会话）：按下方「冷启动」步骤操作——**循环驱动
只有一个**：步骤 4 的 `CronCreate`（20 分钟 cron）。Monitor 是事件监测，不是驱动。两个都做完再进
tick 步骤。不要在这之外再起 `/loop`（固定间隔 `/loop` 底层就是同一个 cron，再起一个等于双触发，
见 §4a）。

---

## 冷启动（新会话 / `/clear` 后的空上下文）

**按顺序做完这 7 步再进 tick 步骤。** 不要凭记忆——你没有记忆。

```bash
cd "$REPO_ROOT"    # REPO_ROOT 见 .quay/config.yml loop.repo_root（或 git rev-parse --show-toplevel）
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

内层是 `cwd` 为 `$REPO_ROOT` 且**不是你自己**的那个 pane（tmux 会话是 `$TMUX_SESSION`，均见
`.quay/config.yml` `loop:` 节；用 `tmux capture-pane -p -t <target> | tail -20` 确认它在跑开发任务
而非编排）。找不到就升级给人。

**4. 重建 cron —— 唯一的循环驱动，这一步最容易漏**

**整个冷启动只有这一个循环驱动机制**：tick 靠它每 20 分钟触发一次。`CronCreate` 的任务是
**会话内的**，会话一结束就没了。新会话必须重建，否则外层再也不会自动触发：

```
CronCreate(cron="*/20 * * * *", prompt="执行 orchestrator-loop-tick.md 中的 tick 指令", recurring=true)
CronList   # 确认它已被列出——没列出的 cron 不是报警，是静默空转
```

**为什么选它（判据：无人值守时最不容易静默停摆）**：

- **可查验**：`CronList` 能列出它，装完能机械判定「恰好一个触发源在跑」——跑
  `bash plugin/scripts/loop-driver-check.sh`，必须报 `LIVE`。
- **固定间隔，无需每 tick 自排下一程**：建好就每 20 分钟自动触发，一次 tick 中断不会断掉整条链。
  自排程（动态 `/loop`，不带间隔）恰恰相反——每次 tick 结束都要记得排下一程，任何中断就静默断链，
  而且没有任何列出工具，无法在需要它之前知道它是否还活着。
- **全流程同一个拼写**：冷启动 skill（`plugin/skills/cold-start/SKILL.md`）用的也是 `CronCreate`，
  文档与 skill 之间没有第二种拼写。

**不要**在这之外再起 `/loop` 或任何别的驱动——固定间隔 `/loop` 底层就是同一个 cron 机制，再起一个
等于双触发（详见 §4a）。

**4a. `/loop` 不是驱动器——不要在这里另起一个**

主推进信号是后台 agent 的完成通知；本文件（外层）的**循环驱动只有一个**：步骤 4 的 `CronCreate`。
`/loop` 不在这里充当驱动，**不要照旧习惯在步骤 4 之外再起一个**：

- **固定间隔 `/loop`（带数字间隔的形式）底层就是 `CronCreate`**——同一个机制、同一种列表。步骤 4
  已经建了 20 分钟 cron，再起一个就是**双触发**（两个 tick 同时跑，竞争共享检出）。
- **动态 `/loop`（不带间隔）走自排程**——没有任何列出工具，且每次 tick 结束都要记得排下一程，任何
  中断就静默断链。对一个专门用来在上下文丢失后兜底的机制，不可查验等于不可信——你无法在需要它之前
  知道它是否还活着。

**今天有现成的证据（缺的不是驱动，是冷启动没做）**：2026-08-02 16:14Z 内层被 `/clear`，新会话只有
5 行上下文，而它当时没有运行中的循环，恢复全靠外层手工简报。缺的是步骤 4 没做——cron 没重建——不是
缺第二个驱动。

**确认恰好一个触发源**：冷启动后跑

```bash
bash plugin/scripts/loop-driver-check.sh
```

必须报 `LIVE`。报 `DOUBLE-TRIGGER` = 有人多装了一个驱动（多半是照旧文档多起了一个 loop）——停下来
处理；报 `STALLED` = 一个都没有——循环不会 tick，回步骤 4 重建 cron。

**4b. 重挂 Monitor —— 和 cron 一样是会话内的**

`Monitor` 与 `CronCreate` 同样活不过会话。新会话必须重挂，否则外层退回纯 20 分钟轮询。
观测只有一个工具（SPEC-one-observer-two-surfaces.md）：`session-liveness.sh`（经
`session-liveness-mount.sh` 单飞挂载入口挂上）：

```
Monitor({command: "$REPO_ROOT/plugin/scripts/session-liveness-mount.sh",   # REPO_ROOT 见 .quay/config.yml loop.repo_root
         description: "会话存活/活跃（SESSION-GONE/BACK/IDLE/RESUMED/REPO-STALL/OVERDUE/HEARTBEAT）",
         persistent: true, timeout_ms: 3600000})
```

**4b2. 重挂套件状态触发者（红窗自动执行者，`gap-red-window-has-no-automatic-executor`）——状态变化即触发，不等 cron**

红窗规则（`gap-full-suite-belongs-to-outer-background-above-3-min` AC4）的 ROUND 2 事故证明「存在≠
生效」：套件转红 30 分钟无人处置，因为 RED/GREEN-RUNNING 两个分支都只靠 `*/20` cron 或人驱动。本条
给它补**执行者层**——状态变化（state=red / state=running）即转成动作（通知外层 / 驱动 inner 派发）。
**它是事件监测（同 session-liveness），不是新调度源**——节奏仍唯一（步骤 4 的 cron）；它只把
「cron 才检查状态」改成「状态变化即触发」：

```
Monitor({command: "$REPO_ROOT/plugin/scripts/suite-state-trigger.ts --monitor",   # REPO_ROOT 见 .quay/config.yml loop.repo_root
         description: "套件状态自动触发（SUITE-RED → 立即 RED 处置；SUITE-RUNNING → 乐观派发执行者）",
         persistent: true, timeout_ms: 3600000})
```

事件流里出现 `SUITE-RED` ⇒ **立即**进入步骤 1b「红窗分诊」（不等下一次 cron——本轮的
「红着无人处置 30 分钟」场景即被消灭）；出现 `SUITE-RUNNING` ⇒ 按「RUNNING 乐观派发执行者」驱动
inner 照常派发。`SUITE-GREEN` / `SUITE-STATUS` 是平静基线，无需处置。挂载遗漏的代价同
session-liveness：退回纯 20 分钟轮询（正是本轮事故形态）——所以 4c 的验证纪律对两者同样成立：
跑 `bash plugin/scripts/monitor-mount-check.sh --json` 之外，还要确认套件触发者的 Monitor 已挂
（`pgrep -af 'suite-state-trigger.ts --monitor'`，有 node 活进程即可；按步骤 0 的自匹配纪律
排除 pgrep 自己那一行——发起查询的命令行里含同样字符串）。

**4c. 重挂后立即验证挂上了 —— 三判据自检**

重挂 Monitor 后立刻跑一次检查器，不靠「看起来挂上了」：

```bash
bash plugin/scripts/monitor-mount-check.sh --json
```

三判据缺一不可：`mounted=true`（挂上了）、`targetRoot` 等于本仓根（挂对了，`targetOk=true`）、
`delivered=true`（AC9 起取代 `ownedByThisSession`——判据是「事件是否真的送达」共享事件文件，不是
「是不是本会话挂的」；别的会话挂的、投递正常必须照样 PASS）。
任何一条不满足都按冷启动失败处理，不要直接进 tick。
`gap-nothing-checks-whether-the-monitor-is-mounted-or-aimed-right`：挂没挂/挂哪个仓库/事件有没有送达
三条判据是**一条不是一条**——只查第一条会漏掉「进程活着、目标错」那次（管理者 18 小时挂错目标）。

**5. 核对前置条件**

`.halt` 是否还在、套件是否绿（读 `.quay/full-suite-state.json` 的 `state`——`green` 绿、`red` 需按
步骤 1b「红窗分诊」处理、缺文件 = 外层还没跑）、内层 loop 是否已启动。见目标任务的 AC1–AC6。

**6. 补记一次 tick**

冷启动本身算一次 tick，动作类型通常是 `no-action`（只是恢复）或 `unblock`（恢复时发现内层停摆）。
在 `tick-log.md` 记一行，注明「冷启动恢复」。

**7. 进入正常 tick 步骤**

## 定位

双层持续开发的**外层**。内层是开发会话（tmux `$TMUX_SESSION`，见 `.quay/config.yml` `loop.tmux_session`），它执行任务；外层观察它、消解它的停摆、
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
tmux capture-pane -p -t "$TMUX_SESSION" | md5sum; sleep 25
tmux capture-pane -p -t "$TMUX_SESSION" | md5sum      # 两次相同 = 空闲
```

**c) 外层的独立核实会和内层抢 CPU——这是机制不是散文。** 步骤 1 写着「只读」，但跑一次全量套件是
**数分钟的满载**，足以把内层 `select-preflight` 那种 timeout 余量只有 8% 的测试压成 flaky。
规则改为**机械执行**：跑全量套件前调用资源闸
`bash plugin/scripts/resource-gate.sh --for full-suite`（`gap-no-resource-awareness-heavy-ops-run-blind`）——
退出码非 0 = WAIT，**此时不要跑全量**，改为核实便宜的声称（文件存在、grep 计数、单文件测试）。
gate 读 `/proc/pressure/cpu` `some avg10`（结构信号，不是 load 代理）并输出数字与限值，把
「现在能不能跑」变成一个可核对的数字。内层在飞时只核实便宜的声称；**全量只串行跑、跑完再叫醒内层**。

**d) cron 只在本会话空闲时触发。** 外层正在和人对话时，`*/20` 的 tick 不会 fire。人机对话期间外层
事实上是停的——所以**每次对话结束前手动补一次 tick**，不要假设 cron 会接上。

**e) 外层挂的 Monitor 可能没挂上、挂错目标、或属于上一个会话。** 2026-08-03 两个反证都是
「不报错的降级」，而且都不是被信号发现的，是人问起来才发现的：archguard 外层**从来没挂上**
（照着 tick 文档做，Monitor 那一步没发生，没有任何东西报错）；管理者自己**挂了 18 小时挂在错的
目标上**（两个监视器都在看内层，而该看的是三个外层）。**一个盯错东西的 monitor 和一个正确的
monitor，从外面看一模一样。**

所以每个 tick 用一条命令自检，不靠人判断：

```bash
bash plugin/scripts/monitor-mount-check.sh --json
```

三判据：`mounted`（挂没挂）/ `targetRoot` 是否等于本仓根（挂的哪个仓库副本）/
`delivered`（事件有没有送达共享事件文件；AC9 起取代 `ownedByThisSession`——判据是「事件是否真的
送达」，不是「是不是本会话挂的」）。挂载判据是 argv 前两 token 精确等于 `bash <绝对路径>`，
**不是子串**——`pgrep -f` 会匹配到发起查询的命令自己（本节上文记的就是这个坑，检查器已绕开）。

### 0b. 事件式监测（Monitor）——补 tick 之间的盲区

20 分钟 tick 的盲区是**内层停摆后的等待时间**。观测只有一个工具：`session-liveness.sh`
（SPEC-one-observer-two-surfaces.md，gap-retire-inner-state-one-observer-targets-by-parameter）。
`inner-state.sh` 已退役——它不观测会话（`tmux` 命中 0），它的招牌信号 `.quay/inner-blocked.json`
在三个项目里从未产生，包括我们撞上过的唯一一次真实事故（那 68 分钟也没有它）。挂成
`persistent` Monitor，事件经共享事件文件送达（详细事件表见 0b2）：

| 事件 | 含义 |
|---|---|
| `SESSION-GONE` / `SESSION-BACK` | 会话进程消失 / 恢复 |
| `REPO-STALL` | 仓库 ≥`STALL_MIN` 分钟无新提交（未暂停的项目）——仓库信号，不是会话面 |
| `SESSION-OVERDUE` | 心跳源 mtime ≥`OVERDUE_MIN`（未暂停的项目）——会话可能已死 |
| `SESSION-IDLE` / `SESSION-RESUMED` | 相邻两轮 pane 哈希相同=空闲；在转换后一个轮询周期内报出 |

**它买什么、不买什么**（2026-08-02 实测得出，别搞混）：

- **买的是死时间**。它把「内层停下等裁定」到「外层发现」的延迟从最多 20 分钟压到 ~1 分钟
- **不买纠偏质量**。同期四次 `correct` 没有一次是延迟受限的——它们受限于视角，见步骤 2 的
  「外层的价值来自视角」。**更快的监测不会让外层看得更准**

**遥测信号的两个方向（`fast-mode-telemetry.ts` 实际定义，随 `--report` 铺出；别写反——本仓曾把
`ORPHAN` 定义成「`--task-start` 已写而 `--task-end` 未写」的反方向，而代码从不这样做，靠这条文档差点判错两次）**：

| 信号 | 实际定义（代码为准） | 去向 |
|---|---|---|
| `ORPHAN` | **end without start**（只有 `--task-end`、没有对应的 `--task-start`） | 进 `orphaned[]`，报表可见，不进吞吐 |
| 有始无终 | **start without end** | 进 `inProgress[]`；**只在 90 分钟后以 `OVER90` 露头**，且与「一个真的很慢的任务」同形——信号上不可区分 |

**崩溃遗留（幽灵）**：执行者被杀死后，`--task-end` 永远不会来，任务永久停在 `inProgress`。先用
`node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --reconcile --json` 关闭
「执行者确实不存在」的记录（判据是可观测的：分支已合并 / worktree 不存在 / 进程不存在，**不是时龄**），
关闭后它才离开 `inProgress`、不再触发 `OVER90`。

**代理信号迟早会误报，能换成结构信号就换。** 2026-08-02 一天里五个检测信号误报，五次的根因是同一个：
**测的东西和声称的东西不是一回事**。

| 检测器 | 代理信号（错） | 结构信号（对） |
|---|---|---|
| `RISKY` | 提交消息里有 "revert" 字样 | body 里 git 自己写的 `This reverts commit` |
| `STALLED` | 遥测 `inProgress` 是否为空 | **正在运行的 `node --test` 进程数** |
| 全量套件分类 | 命令文本里提到 `test.sh` | `test.sh` 出现在命令位置（剥离引号内容后） |
| `--clean-stale` 安全性 | 提交数为 0 | 提交数 0 **且**两点 diff 为空 **且** worktree 无未提交改动 |
| 滞留分支告警（步骤 1 的 `--stranded`） | 没有任何检查 → 靠人偶然 `git worktree list` | 三闸（reclaim 已验证）：`merge-base --is-ancestor` → merge-added 文件是否仍在 master → 分支领先计数；`has-commits`/`merged-then-reverted` 报出，`merged-clean` 不报 |
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
用 `pgrep -c -f "$TEST_COMMAND"` 数并发套件（`TEST_COMMAND` 见 `.quay/config.yml` `loop.test_command`），得到 3 且「在上涨」，几乎据此向人报告「内层没执行
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

**找一个监听中的服务，要按端口不按命令行**（2026-08-03 实证）：
`pgrep -f 'quay.ts serve --host <ip>'` 会匹配到**发起查询的这条命令自己**，
`kill` 于是杀掉外层自己的 shell（exit 144）而目标进程毫发无伤。
正确写法 `ss -ltnp | grep <port>` 取 pid ——**端口不可能属于发起查询的进程**。

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
主动写——见 [[gap-no-explicit-blocked-signal-from-inner-layer]]。**已部分闭合**（gap-ruling-required-
trigger-is-dead-code-never-wired-into-any-tick）：步骤 1 的 `--detect-stop --pane` 屏幕观察者现在能
从 pane 形状直接看到 `waiting-input` / `permission-prompt`（3 采样一致），不再只靠遥测缺席推断。

### 0b2. 会话存活监视（`session-liveness.sh`）——看会话本身还在不在

**看的是【会话】本身**（进程消失 / 恢复 / 活着但不推进 / 转入空闲），对**任何 Claude Code 会话**
成立，外层与内层通用（原 `outer-liveness.sh`，AC10 泛化改名——名字取窄了，这套逻辑与「外层」
无关）。随 `quay-init --loop` 铺下，会话名在安装时被替换；默认零配置看本项目自己的会话。

| 事件 | 触发 | 信号源 |
|---|---|---|
| `SESSION-GONE` / `SESSION-BACK` | 会话进程消失 / 恢复 | 会话面 |
| `REPO-STALL` | 活着但仓库 ≥`STALL_MIN` 分钟无新提交（未暂停的项目） | **仓库信号，不是会话面**（AC8，原 `SESSION-STALL`） |
| `SESSION-OVERDUE` | 心跳源 mtime ≥`OVERDUE_MIN`（未暂停的项目）——会话可能已死 | 会话面（心跳源=transcript） |
| `SESSION-IDLE` / `SESSION-RESUMED` | 相邻两轮 pane 哈希相同=空闲；**在转换后一个轮询周期内报出** | 会话面 |

**外层挂一个监视器（AC12 已随 inner-state.sh 退役而收口）——它答「会话还在不在」：**

`session-liveness.sh` 看【会话】本身：进程活/死、忙/闲、心跳逾期没有。**内层的心跳是它的会话
transcript**（AC1/AC16，2026-08-03 实测选定）——`.workflow-events/` 每任务只写 1-2 行、任务
进行中完全冻结，不是有效心跳源；transcript 每次工具调用都写（含 subagents 目录）。经
`SESSION_TRANSCRIPTS`（会话 id 或绝对路径）或 `SESSION_HEARTBEATS` 配置；外层心跳是 tick 日志。
**解除停机（删 `.halt`）那一刻重置陈旧度基线**，停泊期间的陈旧不计入解除停机后的
OVERDUE/REPO-STALL（协调方 2026-08-03 样本）。

**四个阈值（AC5，含义与默认值在这里，不只活在脚本注释里）：**

| 阈值 | 默认 | 含义 |
|---|---|---|
| `INTERVAL` | `60` | 轮询周期（秒）。每轮抓一次每个目标的状态；「转换后一个轮询周期内报出」的「及时」颗粒 |
| `STALL_MIN` | `45` | 未暂停的项目超过这么久（分钟）无新提交 = 停滞（`REPO-STALL`，仓库信号） |
| `LOOP_MIN` | `20` | **`SESSION-IDLE` 静默判据的边界**（抑制阈值）：空闲时心跳时距 `< LOOP_MIN` = 刚动过的正常收尾（静默）；`≥ LOOP_MIN` 或未知 = 「空闲了但没动」，报。OVERDUE 文案里的「预期周期」是固定常数 `EXPECTED_CYCLE_MIN`，与它拆开（LOOP_MIN 可设 0，文案不应打「预期周期 0 分钟」） |
| `OVERDUE_MIN` | `30` | 心跳源 mtime 超过这么久（分钟）未更新 = 会话逾期（`SESSION-OVERDUE`）。**AC5（原 AC13）不可自愈类宁可误报：默认 45→30**——阶段一实测 transcript 心跳在长任务中的最大间隙 20.5 分钟，30 分钟早报 15 分钟且仍留 ≥9 分钟余量（漏报代价无界，误报只多一次廉价核查） |

**噪声标定（2026-08-03，管理者 3 个完整周期实测）**：健康循环 = `SESSION-RESUMED`（按周期活动）
→ 干活 → `SESSION-IDLE`（心跳 1 分钟前更新），每 20 分钟一对事件、三项目满载 18 次/小时。
`SESSION-IDLE` 在心跳时距小于 `LOOP_MIN` 时静默——那是正常收尾；`SESSION-RESUMED`
**保留不静默**（它便宜，且是唯一能确认会话还在按期活动的正向信号）。

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

**外层自己写 `## Contract` 时最常犯的一条（2026-08-03 一小时内踩了三次）**：
第二个 `measure` 写成「**同上命令**输出的 X 字段」——人读得懂，检查器读不懂，
判据是「该行有没有自己的反引号命令」，于是每次都报 `measure-no-command`。
**每个 `measure` 行都要自带完整的反引号命令，哪怕与上一行逐字相同。**
同族的另外两条也一并记住：`control` 折行 ⇒ `contract-line-unknown`（一行一键不可折行）；
`invoke` 命令若含 `<ISO>`/`<file>` 占位符，`invoke-evidence-missing` **在构造上无法满足**
（见 [[gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed]]）——
写 invoke 时用一条能原样跑、也能原样贴回证据的命令。

### 0d. 跨项目暂停/恢复（人 2026-08-03 裁定：用 `.halt`，粗糙可接受）

三个项目（quay / archguard / meta-cc）各自的**唯一开关**就是仓库根的 `.halt`：

```bash
# 暂停
echo "<理由> | 解除条件: <条件> | 外层 <ISO>" > <repo>/.halt
# 恢复
rm <repo>/.halt
```

**为什么够用**（实测 `select-preflight.ts:113`）：

- 文件**内容会被当作暂停理由读出**——开关自带说明，不需要另一个地方记
- **除 ENOENT 外的任何读取失败都 fail-closed**（权限/是目录/I/O 错误 → 判为已暂停）——
  这个形状是从 `gap-halt-sentinel-path-mismatch` 那次真实事故学来的
- 空文件也算暂停

**已知且接受的粗糙之处**：`.halt` 使整个 tick 空转，**fan-in（步骤 2）也停**。
所以在飞任务会算完但不落地，直到解除。**人已裁定接受这一点。**
缓解只有一条纪律：**暂停不是终点，解除条件必须写在 `.halt` 内容里**。

**外层每个 tick 必须报三个项目的 `.halt` 状态**——这是「暂停后忘了」的唯一防线：

```bash
# 每个目标项目的根见各自 .quay/config.yml loop.repo_root（quay 自己的清单：quay/archguard/meta-cc）
for d in <目标项目根清单>; do
  printf "%-12s %s\n" "$(basename $d)" \
    "$([ -f "$d/.halt" ] && echo "暂停: $(head -c 80 $d/.halt)" || echo 运行中)"
done
```

**优先级（人已裁定）**：**quay 高于 archguard / meta-cc**。
必要时暂停后两者以保本仓推进。**优先级由暂停哪个项目执行，不进跨项目令牌**——
令牌只回答「现在谁能跑重型操作」，不回答「谁更重要」。

### 1. 观察（只读，不动手）

```bash
tmux capture-pane -p -t "$TMUX_SESSION" > .quay/last-pane.txt   # 内层在做什么（全量，喂给 --pane 观察者）
tmux capture-pane -p -t "$TMUX_SESSION" | tail -20              # 人读：底部 20 行
git -C "$REPO_ROOT" log --oneline -10               # 落地了什么
git -C "$REPO_ROOT" status --short                  # 树是否干净
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --stranded   # stranded worktree branches (gap-stranded-...: silent fail-closed alarm)
cat docs/analysis/batch2-queue-state.md             # 内层自报的队列状态
```

**`ruling-required` 屏幕观察者（外层是主轮询方，`gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick`）**：
`--transcript` 从未进过任何生产调用，是死代码；现在 `ruling-required` 的主判据是**屏幕形状分类**。
外层按分钟（60s）轮询内层 pane，把捕获喂给 `--detect-stop --pane`：

```bash
tmux capture-pane -p -t "$TMUX_SESSION" > .quay/last-pane.txt && \
node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --pane .quay/last-pane.txt
```

`classifyPaneState` 只读**底部区域**（ADR-016 修订 boundary b——不做整屏哈希），连续 3 次
`waiting-input` / `permission-prompt` ⇒ 自动写 `.quay/inner-blocked.json`（`reason: "ruling-required"`
+ 可行动 `question` + 底部区域 `evidence`）；`busy` / 其它形状 / pane 缺失 / `--clear` 都重置计数
（AC4 双向负控制）。3 采样 × 60s ≈ 3 分钟 ≤ 5 分钟 p100 预算（裁定 C）。stdout 的
`pane_decision=...` 行是判定分支字段（Contract measure 读它）。`--transcript` 保留但只作「会话真的
死了」的旁证（AC3），不是主判据。**在飞 agent 消歧（外层裁定 2026-08-04）**：`waiting-input` 在状态区
有「← N agent」（N>0）/ `general-purpose`，或遥测有在飞任务 bracket 时是**良性空闲**（等自己的后台
agent），不写块——`permission-prompt` 恒为人类等待，不被抑制。

**以 git 和实测为准，不以内层的自述为准。** 内层报告过「AC9 满足」而实测 627s 超限；报告过任务
done 而 DoD 未勾。每个 tick 都要独立核实至少一项它声称完成的事。

**核实优先查 transcript，不要靠重跑。** 重跑一次全量套件是 8 分钟 + 8 路满载，还会把内层的
timeout 余量压成 flaky（步骤 0c）。查 transcript 是秒级、零干扰：

```bash
node plugin/scripts/inner-forensics.mjs verify 全量套件 --since <上次 tick 的 ISO 时刻>
node plugin/scripts/inner-forensics.mjs timecost --since <外层 loop 起点或本班次起点>
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

### 1b. 异步收尾例程（verification-round closure pass，强制）

**批次边界的真源是记账同步，不是措辞**（`gap-closure-sync-is-the-true-batch-boundary-move-
bookkeeping-to-outer-async`，人 2026-08-05 设计裁定，决定不是建议）：「Close batch-N」三次在 inner
派发历史里、每次收尾后必跟 3 连发、收尾期间零新派发 ⇒ 记账曾是调度的同步点。**inner 只执行 + 派发 +
合并，永远不因记账停顿、也不知道收尾存在；收尾是本层（外层 20-min cron）的异步活。** 本步骤每个
tick 做一次收尾 pass。

**探测用 `taskWorkLanded`，不用 `status: done`**（技术安全已核，无隐藏依赖）：`ready-pool-check.ts`
的 `notYetFlipped` 走 `taskWorkLanded(task.body, repoRoot)`（`ready-pool-check.ts:128-130`），不依赖
`status: done` 字段——所以 inner 的就绪池计算不受收尾异步化影响，外层延迟翻 done 不会导致任务被重复
派发。

**每 tick 执行：**

1. **探测落地未翻任务**：
   ```bash
   node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$REPO_ROOT" --json
   ```
   读 stdout 的 `excluded[]`：`reasons` 含 `not-yet-flipped` 的条目 = 工作已落地（`taskWorkLanded`
   为真）但 `status` 仍 `ready` 的任务——正是 inner 合并完成、等待收尾的任务集。**复用现有实现，
   不新建探测脚本。**
2. **逐个收尾**，对每个 `not-yet-flipped` 任务：
   - **关遥测括号**：先 `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts
     --report --json` 拿 `inProgress[]` 里该 `taskId` 的 `runId`，再
     `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --task-end
     --taskId <id> --runId <r> --outcome done`。若 `inProgress[]` 里找不到该任务的 runId（无对应
     `--task-start`），跳过 `--task-end`，只翻 done。
   - **翻 done**：核对 AC/DoD 是否真实满足（与旧 inner fan-in 同一纪律：勾得上就勾、勾不上写理由
     或留 `ready`），然后写 `tasks/<id>.md` 的 `status: ready → done`（写 `tasks/` 是外层授权范围）。
   - 记进本轮 `closed` 清单。
   - `needs-human` 任务不在 `not-yet-flipped` 里（工作没落地）；其遥测括号由 `--reconcile`（执行者
     已消失）或本层手动 `--task-end --outcome needs-human` 闭合，别让它滞留 `inProgress` 触发 OVER90。
3. **全量 suite = 外层后台异步验证 gate（非 inner 同步点、非本 tick 阻塞点）**：
   - **后台跑**：全量 suite 由本层起 `plugin/scripts/full-suite-runner.ts`（后台 subagent /
     `run_in_background:true`，不阻塞本 tick、不堵 inner），runner 写 `.quay/full-suite-state.json`
     （`{state: running|green|red, runner: outer|inner, startedAt, finishedAt, durationMs,
     laneCount}`）并把套件输出 tee 到 `.quay/full-suite.log`。**起跑条件**：本轮收尾了 ≥1 个任务
     （或自上次完成的全量 suite 起有新的 merge 落地）且当前没有在跑的 suite（`state != running`）
     且资源闸放行（`bash plugin/scripts/resource-gate.sh --for full-suite`，退出非 0 = WAIT，下一
     tick 再起）。
   - **早期 RED（AC2）**：runner **一检测到失败立即把 state 标成 red**（非等全套跑完）——缩「变红到
     发现」窗口。判红模式 = `not ok` / `✖` / `# fail [1-9]` / `# cancelled [1-9]` /
     `FULL-SUITE-EXIT` 非 0 / 退出码非 0。`state: red` 即 AC4 的 **stop-dispatch 信号**（inner 读它
     停派发 + 暂缓 fan-in，见下「红窗分诊」）。
   - **本轮的 suiteGreen**：读 `.quay/full-suite-state.json` 的 `state`——`green` ⇒ true；`running`
     ⇒ true（RUNNING 还没失败，proceed，这正是消除同步点的关键）；`red` ⇒ false；**缺文件 ⇒ true**
     （外层还没跑第一轮，不阻塞）。
4. **写轮次记录**：追加一行到 `.quay/verification-round.jsonl`：
   ```json
   {"round": <N>, "at": "<ISO 来自 date -u>", "suiteGreen": <bool>, "closed": ["<id>", ...]}
   ```
   `N` = 上一条记录 `round` + 1（空文件从 1 起）。`suiteGreen` = 步骤 3 读 `.quay/full-suite-state.json`
   的判绿结果。**inner 的停止条件现在直接读 suite-state**（`fast-mode-loop-tick.md` 步骤 3），本文件
   的轮次记录只是收尾记账，不再被 inner 读取：
   - 缺 suite-state ⇒ inner 不阻塞（外层还没跑第一轮）；
   - `state: red` ⇒ inner 停止派发 + 暂缓 fan-in，本层按「红窗分诊」处置（bisect 定位新引入还是既有；
     定位到本轮 merge 引入就回退该 merge + 回退对应翻 done）。
5. **落盘聚合**：本轮收尾后跑一次
   `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --snapshot`，
   否则被 git 跟踪的聚合文件不反映本批结果。

**每 tick 必报**补一条：本轮收尾几条、`.quay/full-suite-state.json` 最新 `state`（green/red/running）
与 `durationMs`、本轮全量 suite 是否在跑/绿/红。

**套件状态自动触发者（红窗执行者层，`gap-red-window-has-no-automatic-executor`——把 (a) 块的
机制从「被动响应驱动」变成「状态变化即执行」，AC1/AC2/AC4）**：

`suite-state-trigger.ts`（Monitor，冷启动 4b2 挂上）在 `.quay/full-suite-state.json` 的
`state` **变化**时立即发事件（5 秒轮询，≪ cron 的 20 分钟窗口）并记 `.quay/suite-state-events.jsonl`
（append-only；`SUITE-RED.at` 就是 `red_to_triage_ms` 的起点）：

| 状态变化 | 事件 | 本层动作（全部是既有逻辑的执行，不是新决策） |
|---|---|---|
| → `red` | `SUITE-RED`（`stopSignal:true`，即确认 stop-dispatch 信号在位） | **立即**进下面的「红窗分诊」（不等下一次 cron；信号 = state=red 本身，(a) 块 AC4） |
| → `running` | `SUITE-RUNNING` | 「RUNNING 乐观派发执行者」：池有 `dispatchable_disjoint ≥ cap` 就按步骤 4 驱动 inner 照常派发（不待轮——(a) 块 AC4 的乐观行为被实际动用，AC3） |
| → `green` | `SUITE-GREEN` | 平静基线，无处置 |

**触发者是执行者，不是新调度源（AC2/AC4）**：它只做「状态变化 → 事件」的翻译与通知，不做任何分诊/
派发决策；分诊 = 本文件下方既有「红窗分诊」，派发 = inner 出厂文档既有 §4 规则。节奏仍唯一（步骤 4
的 `*/20` cron）；Monitor 是事件监测（同 session-liveness），不驱动任何 tick。事件日志只记事实，
处置逻辑在文档/既有实现里——触发者不引入第二条决策链。冷启动即红（外层 `/clear` 后套件仍红）也触发
`SUITE-RED`（第一眼即红），正是本轮「红着无人处置」形态的兜底。**触发链自检**（Contract invoke）：
`node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check`
（构造失败 suite ⇒ state=red ⇒ SUITE-RED 事件 ⇒ stopSignal 在位，退出 0 = 链完好）。

**红窗分诊（外层独占，AC4——只停派发不停在飞合并会让红树继续累积，故 RED 时 fan-in 一并暂缓）**：
`.quay/full-suite-state.json` 的 `state: red` 即 **stop-dispatch 信号**（runner 一检测失败即写，AC2；
套件触发者发 `SUITE-RED` 时确认它在位）。state 为 red 时：
1. **本层独占分诊**，不把红树丢给 inner：对 red window 内新合并的 merge 二分定位（`git bisect` 或按
   merge 顺序回滚、逐个重跑 `--for-task` 选中集判断肇事者）。
2. **回滚/修复**：定位到某次 merge 引入 → 回退该 merge（+ 回退对应翻 done）；判定为既有失败 →
   建任务（`tasks/` 属本层授权范围）。**state: red 期间本层不自动重启套件**——先分诊，修好才重启。
3. **重启套件**：修复后重新起 `full-suite-runner.ts`（state → running）。
4. **重新 green**：runner 完成且绿 ⇒ state → green。
5. **撤信号**：state 回到 green/running 即撤——inner 恢复派发与 fan-in。信号是存在性状态，无需单独
   删文件。

**阈值决策规则（AC5，门槛机械化）**：测全量套件耗时 `suite_duration` = `.quay/full-suite-state.json`
的 `durationMs`（runner 每次跑完写入，即测量 hook）：
- `suite_duration ≥ 3 分钟` ⇒ **outer 集中后台跑**（当前形态，实测 11-12 分钟量级）；
- `suite_duration < 3 分钟` ⇒ **下放 inner 各任务自己跑**（批概念彻底消除）。
规则在内外层 loop 文档各写一份；每次全量 suite 的 `durationMs` 就是判定输入。

**三块消除批次（AC7）**：本条是 **(a) 套件块**；收尾/记账 **(b) 块** =
`gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async`（已落地）；AC/证据
**(c) 块** = `gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence`
（在队列）。三块合起来，inner 侧只剩「执行 → 合并」，没有任何批次同步点。

### 1c. 重锚转发（re-anchor，强制——机制不是散文）

**给 inner 一个独立于外层措辞的周期锚。** 背景（gap-inner-has-no-periodic-anchor-prose-only-drives-
drift，管理者实测 + 裁定）：inner 的 Cron 调用数 = 0、整晚 59 次驱动全来自外层 send-keys 散文，而
外层自己每 20 分钟被 cron 强制重读出厂文档——**锚点不对称是 inner 行为漂移的结构根**。R2（驱动散文
只带数据不带行为）管散文别越权；本步管「散文之外还有周期锚」。

**机制 = 用本层已有 cron 转发一条固定重锚 prompt，不是给 inner 另建 cron、不是每次现写散文：**

1. **判空闲才转发**：本 tick 已判 inner 空闲才转发（「空闲」按本层既有观察判据：pane 哈希两次相同、
   且遥测无在飞任务 bracket、且不是 `ruling-required` 等待人类裁定——忙时不打扰）。**重锚量上界 =
   空闲时长**，外层 cron（`*/20`）仍是唯一节奏源。
2. **转发固定常量，逐字原样**：转发的文本 = `plugin/scripts/reanchor-prompt.txt` 的内容，
   **逐字原样**（`cat plugin/scripts/reanchor-prompt.txt` 读出来发），**不是本层现写的新段落**。
   送达走既有 send-keys 信道（`C-u` → 常量文本 → `Enter`，三次分开调用；发完 `capture-pane` 确认
   出现新的 `⏺` 输出——未确认送达的重锚等于没发）。**这不是新增唤醒源**：节奏仍是唯一 `*/20` cron，
   信道仍是既有 send-keys，只是把固定文本从文件转发出去。
3. **唤醒契约 = 一致性核对，不是调度**（AC2）：重锚 prompt 是「重读出厂 `fast-mode-loop-tick.md` +
   按「状态自检清单」核对当前状态是否符合（在飞 / 就绪池 / 收尾 / 停止条件四查）+ 明确偏差向文档
   自我修正」。它**零派发指令**——机械保证是 grep 断言：
   `grep -n '派发\|排序\|batch\|批' plugin/scripts/reanchor-prompt.txt`（期望 0 命中；
   `plugin/test/reanchor-prompt.test.mjs` 固化）。
4. **偏差修正若需派发，逐字照搬出厂文档自己的派发规则**（文档是唯一规则源）：重锚 prompt 不做新决策
   ——inner 核对发现需补队/派发时，照 `fast-mode-loop-tick.md` 步骤 3.6/4 自己的规则执行，不是重锚
   prompt 给的新指令。
5. **每个 tick 必报**：本轮是否转发重锚、转发时 inner 的空闲判据（哪条观察判据成立）。

**为什么「空闲才转发」**：重锚是「给 inner 一个周期读出厂文档的机会」，不是催活。inner 忙时
（在飞 agent / 有 bracket）读文档的机会会打断工作；空闲时转发才是在它回合结束时给下一次行为对齐
锚点。**与驱动散文的关系**：驱动散文带任务数据（R2 约束），重锚零数据、只指向文档——两者互补。

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
| 全量 suite 红（`.quay/full-suite-state.json` `state: red`） | 按步骤 1b「红窗分诊」独占处理：bisect 定位肇事 merge（新引入）或既有失败（建任务）→ 回滚/修复 → 重启套件 → 重新 green → 撤信号 |
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

**就绪池维持（todo→ready 晋级）不再靠外层自愿 AC-queue**（`gap-promotion-cadence-is-role-volition-
not-product-mechanism`，2026-08-04 人方向裁定）：晋级节奏与优先级是**产品机制**，由内层 tick
`fast-mode-loop-tick.md` 步骤 3.6「就绪池维护」承载——内层跑 `plugin/scripts/ready-pool-check.ts`
（读 stdout `pool` 字段；`pool < floor`（=cap×4，默认 12）按脚本推荐的顺序补晋；**判据是
`dispatchable_disjoint ≥ cap`**，floor 只是手段）。**外层只引用它，不独立维护候选集构造规则**
（旧 `outer-phase-goal.md` AC-queue 已降级为引用）。本步骤的 `gap-*` 优先顺序与内层 checker 的定义
顺序同源，不再各写一份。

把补充结果写进队列状态文件，指示内层派发。

### 4a. 驱动文本只携带数据，不复述行为（外层裁定 R2 — gap-drive-text-carries-data-not-behavior-outer-inner-handoff，AC2）

给内层下指令时，**驱动文本只携带数据，不复述行为**：

| 随文本过去（数据） | 不随文本过去（行为） |
|---|---|
| 任务 id、裁定结论、依赖事实（如「B 消费 D 的 classifyPaneState」） | 怎么派发（并发/串行）、worktree 位置、纪律清单、并发上限 |
| 需要裁定的问题 + 选项 | 出厂 `fast-mode-loop-tick.md` §4 已供给的一切 |

行为一律由出厂文档供给——出厂文档的行为错了就**改文档**，不用散文覆盖（2026-08-04 实锤：外层把
「按 A→D→B 顺序」写进驱动文本，内层忠实串行 A 6m11s，而出厂文档 §4 明确要求并发 `Agent(run_in_background)`——
常驻并发指令第二次静默丢弃）。

**自检清单（列任务时二选一，缺一即违规）**：

1. **不定顺序**——只给任务 id 与依赖事实，顺序由内层按出厂文档 §4 的并发规则自行决定；或
2. **要定顺序就附 `checkTouchesPair` 实际输出**，且顺序断言与 pair 输出必须在**同一条驱动文本**里
   （AC3 的位置判据）：
   ```text
   A-D: {"disjoint":true,"overlaps":[],"reason":"disjoint file-sets"}   # 机械证据
   ```

若上一 tick 的驱动文本被内层**标注了「与出厂派发契约矛盾」**（内层 fail-safe：以出厂文档为准并标注），
本 tick 先按标注修正文本再继续派发——读内层标注了什么，不无视它。

### 4b. 「在飞」词汇拆分 + 输入框纪律（AC7/AC8 — gap-drive-text-carries-data-not-behavior-outer-inner-handoff）

**「在飞」拆为两种含义，报告/队列状态里分别标注**（AC7，2026-08-04 第三次实锤后加）——混用会让并发
指令看起来已满足：

| 词 | 含义 | 用什么核实 |
|---|---|---|
| **遥测括号在飞** | `--task-start` 已写、`--task-end` 未写 | 遥测 `inProgress[]` / START 事件——START **只证括号在飞，不证 subagent 在飞** |
| **subagent 在飞** | 内层真的起了后台 `Agent(run_in_background)` | **读原始 Agent 工具调用的 `input.run_in_background` 字段**（meta-cc transcript 查询）——唯一可靠判据 |

**外层核实并发必须读原始字段，不得用 START 事件或 pane UI 文字。** 实例（本 tick）：内层唯一 Agent 调用
`run_in_background` 缺失，而 START 事件显示 A|D 双在飞——用错仪器导致静默满足，正是本条目要消灭的形态。
报告/队列状态里分别写「括号在飞 N」「subagent 在飞 M」，不合并成一个「在飞」。

**输入框是待提交缓冲区，不是笔记本（AC8）**：

- **不得把下一步备忘写进自己的输入框。** `*/20` cron 触发时入队的 prompt 会与框内残留文本拼接成乱码
  （2026-08-04 实锤：前一条截断、后一条接在断口上）。下一步备忘一律落队列状态文件或 tick-log。
- 输入框**用完即空**（`C-u`）。
- **每个驱动回合结束由外部观察者（或下次驱动前 `capture-pane` 核对）确认框空**，并接受「框内残留可能
  来自入站回显而非自写备忘」这一事实——**问责对象是「框里有文本」这一状态，不是「谁写的」**（自清/自证
  不可靠：框会被动接收文本，唯一可靠观察者是外部会话）。

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
- `fast-mode-loop-tick.md` —— 内层机制的修正
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
- **重新排程由步骤 4 的 `CronCreate` 接管**：它按 `*/20` 固定间隔自动触发，不需要每 tick 手动排
  下一程。（不要用自排程——它没有任何列出工具，且每次 tick 都要自排下一程，任何中断就静默断链。）

## 每个 tick 必报

- 动作类型（`no-action` / `unblock` / `correct` / `escalate`）
- 独立核实了内层的哪一项声称，结果如何
- 内层在飞任务数与各自已运行时长
- 遥测当前：任务数、均耗时、`tasksPerHour`（吞吐 = 收尾数/墙钟窗口小时，带 `windowStart/End/Hours`；
  `serialEquivalentPerHour` = 旧 60/均耗时，与并发无关）
- 异步收尾例程（步骤 1b）：本轮收尾几条、`.quay/full-suite-state.json` 最新 `state`（green/red/running）
  与 `durationMs`、本轮全量 suite 是否在跑/绿/红
- 套件状态触发者（4b2/步骤 1b）：Monitor 是否挂上（`pgrep -af 'suite-state-trigger.ts --monitor'`，
  排除 pgrep 自己那一行）、最近一次 `SUITE-*` 事件（`.quay/suite-state-events.jsonl` 尾部）与时刻
- 累计动作类型分布（退化判据）
- Monitor 三判据（`bash plugin/scripts/monitor-mount-check.sh --json` 的 `mounted` /
  `targetRoot` 是否等于本仓根 / `delivered`）——挂没挂、挂的哪个仓库、事件有没有送达，三条一条都不能少
  （AC9 起 `delivered` 取代 `ownedByThisSession`）

不要只说「内层在跑」——没有这些，分层是否有效无法判定。

## 相关文件

| 文件 | 作用 |
|---|---|
| `orchestration/exp6-phase1-sustained-unattended-operation.md` | 目标、AC、DoD |
| `fast-mode-loop-tick.md` | 内层 tick 指令 |
| `docs/analysis/batch2-queue-state.md` | 队列状态（内层写，外层读+补） |
| `orchestration/escalations.md` | 攒给人的非常规项 |
| `orchestration/tick-log.md` | 每 tick 记录 |
| `.quay/full-suite-state.json` | 外层后台全量 suite 的状态（`{state, runner, startedAt, finishedAt, durationMs, laneCount}`；**inner 停止条件读它**——`red` 即 stop-dispatch 信号；gitignored 运行时态，步骤 1b 由 full-suite-runner 写） |
| `.quay/suite-state-events.jsonl` | 套件状态转变事件日志（append-only；`SUITE-RED/RUNNING/GREEN` + `at` + `stopSignal`；gitignored 运行时态，`suite-state-trigger.ts` 写） |
| `.quay/suite-state-last.json` | 套件状态触发者的记忆文件（上次观测的 state；gitignored 运行时态，`suite-state-trigger.ts` 写——跨重启保持转变检测，冷启动即红也能触发） |
| `.quay/verification-round.jsonl` | 外层异步收尾的轮次记录（`closed` 清单 + `suiteGreen`；gitignored 运行时态，步骤 1b 写） |
| `adr/ADR-021-*.md` | 四项原则 |
| `docs/proposals/exp6-queue-driven-concurrent-executor.md` §0 | 两阶段交付范围 |
