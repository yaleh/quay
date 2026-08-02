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

- 更新 `orchestration/tick-log.md`：时刻、动作类型、做了什么、内层状态快照
- `ScheduleWakeup` 20 分钟（1200 秒）

## 每个 tick 必报

- 动作类型（`no-action` / `unblock` / `correct` / `escalate`）
- 独立核实了内层的哪一项声称，结果如何
- 内层在飞任务数与各自已运行时长
- 遥测当前：任务数、均耗时、tasksPerHour
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
