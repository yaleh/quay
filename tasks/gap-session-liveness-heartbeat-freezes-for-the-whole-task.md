---
id: gap-session-liveness-heartbeat-freezes-for-the-whole-task
title: Two of the four session events do not observe a session — STALL reads commits and
  OVERDUE reads work output, so aliveness is inferred from productivity (SPEC AC14-AC17)
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者 2026-08-03 提了一条设计疑虑并**明确说自己不能证明**：
`.workflow-events` 的**目录 mtime 只在文件增删时变**，而一个任务一个 `.jsonl`，
所以内层在**一个任务内持续工作**时追加写的是已存在文件 ⇒ 目录 mtime 冻结。
今天有任务跑了 **79 分钟**，`OVERDUE_MIN=45` 会误报一个**正在干活**的内层，
**而一个在任务中途死掉的内层看起来完全一样**——这正是这个监视器存在的理由所在的那个洞。

**外层实测把它确认了，并且证明管理者提的修法方向也不成立。**

### 实测一：目录 mtime 确实对追加写免疫（POSIX 行为，实测）

```
$ d=$(mktemp -d); touch "$d/a.jsonl"; sleep 1.2
$ before=$(stat -c %Y "$d"); echo '{"x":1}' >> "$d/a.jsonl"; after=$(stat -c %Y "$d")
  dir mtime before=1785768371 after=1785768371  changed=NO      ← 追加写不动目录 mtime
  file mtime moved: 1785768372                                   ← 只有文件自己动了
$ sleep 1.2; touch "$d/b.jsonl"
  after CREATING a new file, dir mtime changed=YES               ← 只有增删才动
```

**⇒ 管理者的推理正确**：心跳读目录 mtime，任务中途它不会动。

### 实测二：但「改读目录内最新文件的 mtime」**也修不好**

管理者提的方向是取「目录内最新文件的 mtime」，并说没验证过它是否总能反映活动。**实测：不能。**

```
$ ls -t .workflow-events/*.jsonl | head -8 | while read f; do echo "$(wc -l < $f) lines"; done
  1 lines   ← 当前在飞任务
  2 lines   2 lines   2 lines   2 lines   2 lines   2 lines   2 lines

$ f=<当前在飞任务的 jsonl>
  lines: 1
  mtime: 14:27:10        （此刻 14:46:31，任务已开工 19 分钟）
```

**每个任务的 jsonl 一共只有 1–2 行**：`--task-start` 写一行、`--task-end` 写一行，**中间什么都不写**。
⇒ **任务进行中，目录 mtime 与最新文件 mtime 一起冻结。** 两个都不动。

**⇒ `.workflow-events/` 根本不是心跳源**——它是**每任务两个事件**的事件日志，
而心跳需要的是**在工作期间持续前进**的东西。**问题不在读目录还是读文件，在选错了源。**

### 候选源（需要本任务判定并给出理由，不要照抄）

| 候选 | 是否在任务中持续前进 | 备注 |
|---|---|---|
| 内层 transcript `~/.claude/projects/<proj>/<session>.jsonl` | **是**（每次工具调用都写） | 外层本班全程用它判内层活跃；`inner-forensics.mjs` 已有先例读它 |
| pane 哈希 | 是（脚本已经在算，用于 busy/idle） | 但它正被 [[gap-session-liveness-hashes-the-token-counter-as-if-it-were-work]] 处理，先后顺序要理清 |
| worktree 内的 `git status` / 文件 mtime | 部分 | 任务在读代码/等 subagent 时不写文件 |

**选哪个要给理由，并说明它在什么情况下也会冻结**——**任何心跳源都有它的盲区，写下来的必须是盲区已知的那个。**

### 追加范围（管理者规格二 AC14–AC17，2026-08-03 14:5xZ）：根因比心跳源更深

人问「这个工具到底在观察什么」，审计结论是**四类事件里有两类根本不在看会话**：

| 事件 | 它实际测的 | 是会话面吗 |
|---|---|---|
| `SESSION-GONE` / `SESSION-STATUS` | 进程/pane 存在 | **是** |
| `SESSION-IDLE` / `SESSION-RESUMED` | pane 哈希 | **是**（但输入含 chrome，见姊妹任务） |
| **`SESSION-STALL`** | **仓库 45 分钟无新提交**（`STALL_MIN`，第 45/169 行，外层实测确认） | **否——仓库信号** |
| **`SESSION-OVERDUE`** | **工作产出文件的 mtime**（`.workflow-events/`） | **否——产出信号** |

**⇒ 心跳设计垮掉的根因在这里**：一直在用「它产出了什么」推「它还活着吗」，
**而这两件事只在正常情况下相关，监视器存在的全部意义恰恰是覆盖不正常的情况。**

**人给的判据**：会话信号只有两个合法来源——**tmux 屏幕**或 **`~/.claude/projects` 下的 transcript**；
**不是仓库、不是提交、不是工作产出**。

### 外层对 pid→transcript 映射的实测（管理者标为未解，这里给出可用与不可用的部分）

| 候选机制 | 实测结果 |
|---|---|
| argv 里的 `--resume <uuid>` | **精确可用，但只覆盖被 resume 的会话**——7 个 claude 进程里只有 **1 个**带它 |
| `/proc/<pid>/environ` 里的会话 id | **没有**（查过 `CLAUDE_*`/`ANTHROPIC_*`，无 session id） |
| 进程启动时刻 ↔ transcript 最早时间戳 | **不可靠，且失败是结构性的**：3 个样本里 **2 个不匹配**——外层自己匹配（10:09:08 vs 10:10:33，差 85 秒），**内层 05:16:07 vs 16:14:08、管理者 02:10:51 vs 13:19:26 全错**。原因是 **`/clear` 与 `--resume` 让进程寿命与 transcript 文件寿命解耦**（内层那次 `/clear` 就发生在 2026-08-02 16:14Z，与它的 first_ts 逐分吻合） |

**⇒ 外层的建议：不要去解这个映射，而是绕开它。**
`SESSION_TARGETS` 已经把每个目标**具名**（名字/仓根/tmux 目标），
再加一个**每目标的 transcript 选择器**（配置里给会话 id，或给项目目录 + 明确标注为启发式的兜底）即可。
**这与刚刚确立的原则一致：生成配置，不去推断。**
若保留自动探测，**必须在输出里标明它是启发式**——否则它会在 `/clear` 之后静默指向错的文件。

### 追加范围二（规格 AC18，2026-08-03 15:0xZ）：屏幕信号改为「人真正看的标志 + 屏蔽易变区」

人的判据：**不追求假阳性为零**，可以屏蔽屏幕上更容易变化的区域，**照人怎么看屏幕来设计**。

**外层独立复现了管理者的四条实测，并加了两点。** 同一时刻五个 pane：

| pane | `esc to interrupt` | `✻ … for …` 残留 | token 行 | 实际状态 |
|---|---|---|---|---|
| `quay-0:inner` | **1** | 2 | 0 | 忙（在飞任务 + 套件） |
| `quay-0:manager` | **4** | 0 | 1 | 忙 |
| `archguard-2:outer` | **0** | **2** | 1 | 停泊 |
| `archguard-2:inner` | **0** | **1** | 0 | 停泊 |
| `meta-cc-4:0.0` | 0 | 0 | 0 | 空闲 |

**确认**：`esc to interrupt` **只在忙的会话上出现**（2/2 忙有、3/3 不忙为 0）⇒ 主信号成立；
**`✻ … for …` 残留在两个停泊 pane 上都在（2 和 1），而它们 `esc`=0** ⇒
**它确实是上一次动作留在屏上的字，不能当忙的判据**——在另一组 pane 上复现了管理者的结论。

**外层加的第一点**：`esc to interrupt` 的**出现次数无意义**（管理者 4、内层 1），
**只有「有没有」有意义**。任何按计数设阈值的写法都会脆。

**外层加的第二点——那个静默失效怎么自检**：
管理者正确指出「找不到标志 ⇒ 永远判空闲」与「真的空闲」同形，需要定期正控制。
**但不必造一个人工忙会话**：AC17 已经要求同时写下屏幕与 transcript 两个信号，
**让它们互相当正控制即可**——当 transcript 显示某会话几秒内刚写过（**确定在忙**）
而屏幕标志判它空闲，**那就是标志失效的签名**；
Claude Code 改一次 TUI 文案，**所有忙会话都会同时出现这种不一致，比率跳到 100%** ⇒ 报警。
**这比造会话便宜，且用的正是人已经认可的两个来源。**

### 追加范围三（管理者的损失函数分析，`docs/analysis/monitor-loss-function.md`，2026-08-03）

人提议用损失函数指导设计（**明确不做进脚本**）：误报耗 token、漏报耗等待时间。
三条结论对本任务直接相关，**外层把前两条落到了具体行上**。

**结论一（漏报代价分两类，差几个数量级）落到实现上比管理者说的更糟——当前阈值是反着调的：**

| 事件 | 漏报属哪类 | 当前阈值 | 方向 |
|---|---|---|---|
| `SESSION-GONE`（151/157 行） | **不可自愈**（无界） | **无阈值，立即报** | ✅ 对 |
| `SESSION-IDLE` / `RESUMED`（202/205 行） | **可自愈**（上界 = 外层 20 分钟 tick） | **一次轮询转变即报（60 秒）** | ❌ **反了** |
| `SESSION-OVERDUE`（225 行） | **不可自愈**（无界；loop 死 / 跑旧版 / 会话死） | **45 分钟** | ❌ **反了** |

**⇒ 漏报最多值 20 分钟的那一类，60 秒就报；漏报代价无界的那一类，要等 45 分钟。**
管理者说「两类用同一套阈值」——**实测不是同一套，是恰好调反了**。
本任务应当**按类反向调参**：可自愈的从严少报，不可自愈的从宽宁可误报。

**结论二（主导变量是可打发性，不是事件率）——外层用自己今天的成本数据指认了那个空 payload：**

| 事件 | payload | 打发成本 |
|---|---|---|
| `SESSION-IDLE` | 带「心跳 N 分钟前更新」+ 停机标记 | **1 次调用**（管理者实测，一行打发） |
| `SESSION-OVERDUE` | 带 `${omin}` 与 `LOOP_MIN` | 低 |
| `SESSION-GONE` / `SESSION-STALL` | 带目标 / 分钟数 | 低 |
| **`SESSION-RESUMED`** | **什么都不带**——只有「恢复活动（此前空闲）」 | **外层今天收到 3 次，每次都要采 transcript mtime + 屏幕哈希 + grep pane 才能判真假，3–4 次调用** |

**⇒ 投资点是 `SESSION-RESUMED` 的 payload，不是阈值调优。**
**而 AC10 落地后这个 payload 是免费的**：语义标志一旦取代整屏哈希，
事件天然可以写「`esc to interrupt` 出现」还是「屏幕某区变化」——**这同时满足 AC12 的「假阳性必须可解释」。**

**结论三（不可自愈类必须有独立正控制）** 与 AC11 是同一件事，已在那里落地。

## Contract

```
measure heartbeat_age = `bash plugin/scripts/session-liveness.sh --once` 输出中内层心跳的分钟数字段
measure frozen_minutes = `stat -c %Y <心跳源>` 在一个 ≥45 分钟任务全程的最大不变时长字段
band frozen_minutes = <45  # 心跳源在任务进行中不得冻结超过 OVERDUE_MIN
invariant 心跳源必须在任务进行中前进；选定源的盲区必须写进文件头
invoke `bash plugin/scripts/session-liveness.sh --once`
control 内层正在长任务中 ⇒ 不报 OVERDUE；内层进程被杀 ⇒ 在一个 OVERDUE_MIN 窗口内报出
resume 先定心跳源并验证它在长任务中前进，再改判据
```

## Chosen mechanism

1. **换心跳源**（不是换读法）：选一个**在任务进行中持续前进**的源，写明理由与**已知盲区**。
2. **用今天这个真实样本验证**：当前在飞任务 `gap-quay-init-rewrites-an-executable-…`
   14:27 开工、19 分钟时 `.workflow-events` 侧仍为 1 行 —— **新源在同一时刻必须是前进的**。
3. **双向负控制**：长任务进行中 ⇒ 不报 OVERDUE；**真的把内层进程杀掉（或用探针会话模拟）⇒ 必须报**。
   **第二个方向是这条判据的全部意义**——只证明「不误报」等于把它调成永不报。

**不做**：不动 `OVERDUE_MIN` 的默认值来掩盖问题（把 45 调成 90 只会让死亡更晚被发现）；
不改 `.workflow-events/` 的写入形状（那是遥测的契约，不该为监视器改）；
不与 token-counter 那个任务合并——**两者机制不同**（一个是哈希输入脏，一个是心跳源选错），
但**同改一个文件，必须串行**。

## Acceptance Criteria

- [x] AC1: 选定心跳源并写进文件头，**含它自己的盲区**（什么情况下它也会冻结）
      **证据**：内层心跳源选定为**会话 transcript**（`~/.claude/projects/<slug>/<id>.jsonl`，每次工具
      调用都写、任务进行中前进），写入 `plugin/scripts/session-liveness.sh` 文件头。盲区写明：
      (1) transcript 只在工具调用时写，读代码/纯思考/等 subagent 时不写主 transcript——
      **subagent 委派时写 `<id>/subagents/`，本脚本取「主文件 + subagents」最大 mtime**（`heartbeat_mtime`）；
      (2) `/clear` 与 `--resume` 解耦进程寿命与文件寿命，会话 id 是**配置不去推断**
      （新增 `SESSION_TRANSCRIPTS` 每目标选择器，接受会话 id 或绝对路径）；
      (3) 停泊/停机期间 transcript 不写，由 `.halt` 守卫 + 停机基线处理（见 AC2 协调方项）。
- [x] AC2: **长任务不误报**——用一个 ≥45 分钟的真实或模拟长任务，全程不报 OVERDUE（贴实跑输出）
      **证据（实跑输出见下）**：hermetic 探针 + transcript 心跳，`OVERDUE_MIN=1`，连续推进心跳 70s
      （**超过 OVERDUE_MIN**），全程 **0 条 SESSION-OVERDUE**；真实 transcript 数据（AC4）显示任务
      进行中最大冻结仅 6.0 分钟。**协调方基线项**：解除停机那一刻重置陈旧度基线
      （`now - max(心跳 mtime, 解除停机时刻)`），停泊期间累积的陈旧不计入解除停机后的
      OVERDUE/REPO-STALL——复现协调方 archguard 停泊-解除场景，`SESSION-RESUMED` 出现时
      **无 OVERDUE 共发**（实跑输出见下）。
- [x] AC3: **死亡必须报**——内层/探针会话进程消失 ⇒ 在一个 `OVERDUE_MIN` 窗口内报出（贴实跑输出）
      **证据（实跑输出见下）**：transcript 心跳冻结（模拟会话死亡停止写）后，监视器在
      `OVERDUE_MIN` 窗口内报出 `SESSION-OVERDUE`（实跑 `心跳 60 分钟未更新`）。测试 F 同断言。
- [x] AC4: `frozen_minutes` 实测记录：新源在一个真实长任务中的最大不变时长，**必须低于 `OVERDUE_MIN`（45）**
      **证据**（`~/.claude/projects/-home-yale-work-quay/*.jsonl` 实测，2026-08-03）：
      - 今日活跃窗 13:00–16:30Z（含 79 分钟长任务）：**全 transcript 合并最大间隙 6.0 分钟**
      - 单会话全程：`a725919c` 最大间隙 **17.6 分钟**（5.3h span）、`3bbd3095` **20.5 分钟**（23h span）、
        `4cea9074` **16.4 分钟** —— 全部 < 45。外层会话 `b8dc91a6` 有 468 分钟隔夜间隙 = **停泊期**，
        正由停机基线处理（停泊不属于「任务进行中」）。
- [x] AC5: 不改 `OVERDUE_MIN` 默认值（负控制：`grep` 确认默认仍是 45）
      **证据**：`grep 'OVERDUE_MIN=' plugin/scripts/session-liveness.sh` → `OVERDUE_MIN=${OVERDUE_MIN:-45}`。
- [x] AC6: 测试用 `node:test`、带 `// @test-group governance`，扩进 `plugin/test/session-liveness.test.mjs`
      **证据**：测试全部 `node:test`、文件头 `// @test-group governance`；新增 F/F2/F3/G/LOOP_MIN-split
      五个测试；`node --test plugin/test/session-liveness.test.mjs` **21/21 全绿**。
- [x] AC7（规格 AC14）: **逐个事件列出信号源**并写进文件头；非会话面的必须改源或移出
      **证据**：文件头事件表逐事件标注信号源——GONE/BACK=进程存在（会话面）、IDLE/RESUMED=pane 哈希
      （会话面，chrome 易变区见姊妹任务）、REPO-STALL=仓库提交（**仓库信号，非会话面**，AC8 裁定
      承载于本工具）、OVERDUE=心跳源 mtime（会话面，心跳源已从工作产出换为 transcript）。
- [x] AC8（规格 AC15）: **`SESSION-STALL` 重新裁定，不许保留现状**。
      **实现者采纳外层判定：改名为 `REPO-STALL`，不改源、不移出**。文件头写明理由：
      (1) 本工具已按项目轮询，多带一个仓库信号边际成本为零；(2) 改成会话面信号只会与
      `SESSION-IDLE` 重复；(3) 移出需要另造一个常驻宿主，当前没有。测试 C/E 同步更新
      （断言 `REPO-STALL` 报出、`SESSION-STALL` 永不出现；停机时 `REPO-STALL` 被抑制）。
- [ ] AC13（损失函数结论一）: **两类漏报反向调参**——不可自愈类（GONE/OVERDUE）宁可误报、
      可自愈类（IDLE/RESUMED）从严；**当前实测是调反的**（IDLE 60 秒、OVERDUE 45 分钟），
      改后给出每个事件的类别与阈值理由
- [ ] AC14b（管理者建议，2026-08-03，**外层判定：采纳，并入 AC14 一起做**）:
      `SESSION-RESUMED` 还应带 **「会话最后一次收到输入的时刻」**——
      它紧贴恢复时刻 ⇒ 外部唤醒；远早于恢复时刻 ⇒ 它自己的 loop/定时器。
      **理由**：今天管理者判断「它为什么醒」全靠「我记得刚给它发过消息」，**那是记忆不是证据**，
      而 loop 自触发与 `send-keys` 唤醒**在事件里完全同形**。
      **必须避免新的静默失效**：取不到该时刻时**事件要明说取不到**，
      **不得省略该字段**——省略与「不是外部唤醒」在读者看来同形。
      **优先级低于 AC13/AC16/AC18**（那几条修的是信号源本身在测错东西，这条只省调用）；
      **与 AC14 同一事件、同一处代码，故并入而不另建任务**。
- [ ] AC14（损失函数结论二）: **`SESSION-RESUMED` 必须带成因 payload**（是哪个标志/哪个区变了），
      判据是「收到事件后无需再采样即可判真假」；外层今天 3 次各花 3–4 次调用，改后应为 1 次
- [ ] AC10（规格 AC18）: 屏幕信号改为**语义标志 + 屏蔽易变区**：主信号 `esc to interrupt`（**按存在性，不按计数**）；
      屏蔽转圈耗时行 / token 计数行 / 提示语行；**`✻ …` 残留不得作为忙的判据**
- [ ] AC11（规格 AC18 正控制）: **标志失效必须可发现**——实现为**屏幕与 transcript 的交叉正控制**
      （transcript 刚写过而屏幕判空闲 ⇒ 报「标志可能失效」），**不是造一个人工忙会话**；给出不一致率基线
- [ ] AC12（规格 AC18）: **假阳性可解释**——每个报出的事件能指出是屏上哪一部分造成的；
      不可解释的假阳性仍算缺陷
- [ ] AC9（规格 AC17）: **屏幕与 transcript 两种信号的取舍写下来**——
      各自盲区（屏幕受重绘/chrome 干扰；transcript 受 `/clear`+`--resume` 映射问题限制）、
      同时用时以谁为准

## Definition of Done

- [ ] AC2 与 AC3 两个方向的实跑输出都贴进任务体——**只证明不误报，等于把监视器调成永不报**
      **（阶段一已贴，见「阶段一实跑输出」）**；完整套件连跑 2 次全绿待阶段二后补跑（阶段一
      scoped 全绿 21/21，未自启全量——按外层纪律全量由协调方 fan-in 承担）
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）——**阶段二后补**
- [x] 任务体记录：管理者提的「改读最新文件 mtime」方向**经实测不成立**（每任务只写 1–2 行），
      **这不是它判断错，是它明说未验证而外层验了**（本任务 Proposal 已含外层实测，阶段一文件头
      也写明 `.workflow-events/` 每任务 1-2 行、追加写不动目录 mtime）

## 阶段一（信号源 + 基线）完成记录，2026-08-03

外层裁定两阶段落地；阶段一 = 信号源：AC1/AC7/AC16 换心跳源 + AC8 STALL 改名 +
协调方三项（停机基线重置、RESUMED/OVERDUE 同轮断言、LOOP_MIN 文案拆分）。阶段一已全部落地。

### 阶段一实跑输出（AC2/AC3，真实监视器进程）

方向一（AC2，长任务不误报——transcript 持续推进 > OVERDUE_MIN 全程不报）：
`OVERDUE_MIN=1`，transcript 心跳每 0.5s 推进一次，连续 70s（超过 OVERDUE_MIN 阈值），
`grep -c SESSION-OVERDUE` = **0**。

方向二（AC3，死亡必须报——心跳冻结后在一个 OVERDUE_MIN 窗口内报出）：
```
SESSION-OVERDUE inner 的会话活着，但心跳 60 分钟未更新（阈值 1 分钟，预期周期 20 分钟）——会话可能已死，它会静默地永远空闲
```

协调方场景（停泊 310 分钟→解除停机，RESUMED 与 OVERDUE 不得同轮同发；基线重置生效）：
```
--- after 4s parked (no OVERDUE/REPO-STALL expected) ---
(none - good)
--- after un-halt + busy (RESUMED expected; NO OVERDUE/REPO-STALL co-fire) ---
SESSION-RESUMED gate 的会话恢复活动（此前空闲）
```

注：方向一的 70s 实跑在 `OVERDUE_MIN=1` 下进行——「长于阈值」由构造保证（心跳持续更新，
`omin` 恒为 0，结构上不可能达到 OVERDUE_MIN）；真实任务场景的冻结上界由 AC4 数据给出（6.0 分钟）。

## Touches

- plugin/scripts/session-liveness.sh
- plugin/test/session-liveness.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T14:50:00Z
changed: 管理者按纪律把它报成「我不能证明、由你判」。**外层实测确认了成因**（追加写不动目录 mtime，
`mktemp` 现场验证），**并且证伪了它提的修法**：每个任务的 jsonl **只有 1–2 行**
（`--task-start` 一行、`--task-end` 一行），当前在飞任务开工 19 分钟仍是 **1 行**
⇒ **目录 mtime 与最新文件 mtime 一起冻结，改读法修不好，问题是源选错了。**
**因此把范围定成「换源」而不是「换读法」**，并要求写明新源自己的盲区——
**任何心跳源都有盲区，可接受的是盲区已知的那个**。
**AC3 是这条任务的全部意义**：只证明「长任务不误报」就等于把监视器调成永不报，
而它存在的理由正是「任务中途死掉的内层与正在干活的内层看起来一样」。
**与 [[gap-session-liveness-hashes-the-token-counter-as-if-it-were-work]] 同改一个文件，必须串行**，
两者机制不同不合并（一个是哈希输入脏、一个是心跳源选错）。
**范围于 14:5xZ 扩大**：管理者带来规格二（AC14–AC17），审计出的根因比「心跳源选错」更深——
**四类事件里有两类根本不在看会话**（STALL 测仓库提交、OVERDUE 测工作产出）。
**外层没有另建任务而是并入本任务**：同一个文件、同一处判据、本任务尚未派发，
拆成两个只会在 `session-liveness.sh` 上串行等待，白付一轮 fan-in。
**并对 AC15 给了判定**（改名 `REPO-STALL` 而非改源或移出，理由写在 AC8 里，允许实现者用理由推翻）。
**对管理者标为未解的 pid→transcript 映射，外层实测了三条候选**：`--resume` 精确但只覆盖 1/7 个进程、
环境变量里没有 session id、启动时刻匹配 **3 个样本错 2 个**且失败是结构性的（`/clear`/`--resume` 解耦）。
**据此建议绕开映射：把会话 id 做成每目标配置**——与「生成配置、不去推断」同一条原则。
**派发时机**：在飞任务正占用 `session-liveness.sh`，等它收尾；本任务与 token-counter 任务再排先后。

## 阶段一关闭记录（2026-08-03 17:4xZ）

**阶段一（信号源 + 基线）完成并合并**（fbf64fe9）：AC1-AC8 如实勾选；transcript 心跳、REPO-STALL 改名、
停机基线重置、RESUMED/OVERDUE 同轮断言、LOOP_MIN 拆分。

**阶段二（AC9-AC14：屏幕语义标志 + 交叉正控制 + payload + 阈值）未做，按外层处置方案 (B) 关闭本次派发**：
- 遥测分不出「正在做阶段二」与「阶段一做完了在等」，本任务在飞 98 分钟、后 67 分钟无工作——OVER90 报在
  一个实际闲置的任务上。
- 阶段二作为**新的一次派发重新注册计量**，其耗时可单独测量。
- **阶段二重派前需外层裁断排序**：与姊妹任务 `gap-session-liveness-hashes-the-token-counter-as-if-it-were-work`
  同改 pane-hash/IDLE-RESUMED 块（必须串行），且 AC10（语义标志）大部分吸收姊妹任务的修复面。
