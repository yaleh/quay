---
id: gap-session-liveness-heartbeat-freezes-for-the-whole-task
title: Two of the four session events do not observe a session — STALL reads commits and
  OVERDUE reads work output, so aliveness is inferred from productivity (SPEC AC14-AC17)
status: todo
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

- [ ] AC1: 选定心跳源并写进文件头，**含它自己的盲区**（什么情况下它也会冻结）
- [ ] AC2: **长任务不误报**——用一个 ≥45 分钟的真实或模拟长任务，全程不报 OVERDUE（贴实跑输出）
- [ ] AC3: **死亡必须报**——内层/探针会话进程消失 ⇒ 在一个 `OVERDUE_MIN` 窗口内报出（贴实跑输出）
- [ ] AC4: `frozen_minutes` 实测记录：新源在一个真实长任务中的最大不变时长，**必须低于 `OVERDUE_MIN`（45）**
- [ ] AC5: 不改 `OVERDUE_MIN` 默认值（负控制：`grep` 确认默认仍是 45）
- [ ] AC6: 测试用 `node:test`、带 `// @test-group governance`，扩进 `plugin/test/session-liveness.test.mjs`
- [ ] AC7（规格 AC14）: **逐个事件列出信号源**并写进文件头；非会话面的必须改源或移出
- [ ] AC8（规格 AC15）: **`SESSION-STALL` 重新裁定，不许保留现状**。
      **外层的判定：改名为 `REPO-STALL` 并在文件头写明它是仓库信号、为什么由本工具承载**
      （本工具已按项目轮询，边际成本为零；改成会话面信号只会与 `SESSION-IDLE` 重复；
      移出则需要另造一个常驻宿主，而当前没有）。**若实现者选另外两条路，必须写明理由推翻本判定。**
- [ ] AC9（规格 AC17）: **屏幕与 transcript 两种信号的取舍写下来**——
      各自盲区（屏幕受重绘/chrome 干扰；transcript 受 `/clear`+`--resume` 映射问题限制）、
      同时用时以谁为准

## Definition of Done

- [ ] AC2 与 AC3 两个方向的实跑输出都贴进任务体——**只证明不误报，等于把监视器调成永不报**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [ ] 任务体记录：管理者提的「改读最新文件 mtime」方向**经实测不成立**（每任务只写 1–2 行），
      **这不是它判断错，是它明说未验证而外层验了**

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
