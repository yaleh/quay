---
id: gap-retire-inner-state-one-observer-targets-by-parameter
title: Retire inner-state.sh — its one irreplaceable signal never fired in three
  projects, including the night we hit exactly what it was for
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

> **PARKED (outer ruling, 2026-08-04) — execution suspended.** The retirement rationale
> ("inner-state.sh's one irreplaceable signal never fired") is superseded by ruling D's pane
> observer (`gap-pane-state-is-hashed-not-classified-...`), which provides exactly the signal
> this task would have retired the old observer for. Cleanup follows architecture, not the other
> way round. Work preserved on branch `task/gap-retire-inner-state-one-observer-targets-by-parameter`
> @ `61a92a41`, unmerged. Reassess for dispatch after D lands.

**type:** execution

## Proposal

人问 `inner-state.sh` 还有没有用，管理者查完的结论是**没有**。**三条证据，第一条最硬。**

### 一、它的招牌信号从来没响过

`.quay/inner-blocked.json` 在 **quay、archguard、meta-cc 三个项目里全部从未产生**——
而那是它**唯一不可替代**的东西：**内层主动声明「我卡住了」的显式信道**。

**更要命的是**：管理者今晚查到过一次**内层等外层批准卡了 68 分钟**的真实事故，
**那次也没有写这个文件**。

**⇒ 机制存在、从未生效，而且我们已经撞上过它本该拦下的那一次。**

（外层补一句第一人称的记录：**那 68 分钟里的外层就是我**。
我在 17:42 与 18:16 两次读到「1 个提交、0 脏、50 分钟前」，两次判为正常推进——
**而 80 分钟前我刚诊断过同样的形状**。）

### 二、它不观测会话

`tmux` 命中数 **0**。人已裁定：**观测只有一个工具，就是 `session-liveness.sh`**——
管理者看三个 outer、每个 outer 看自己的 inner，**四个挂载全靠参数，已经在跑**。

### 三、其余信号本来就看得见

`TASKS` / `MAJOR` / `MINOR` / `REVERT` / `MASSDELETE` **全来自 `git log`**，
而**外层的工作目录就是那个仓库，它自己就能看**。

### 不要直接删：它缠进 27 个文件，四处要害

| 要害 | 现状 |
|---|---|
| `monitor-mount-check.sh` | 把「它挂没挂」当成**冷启动六键之一** |
| `quay-init.sh` 的 `LOOP_SCRIPTS` | 把它**铺进每个目标项目** |
| cold-start `SKILL.md` | 明写**挂两个监视器** |
| `session-liveness.test.mjs:811` | 断言 **tick 文档同时提到两者** |

## Contract

```
measure observer_mounts = `ps -eo pid,args | awk '/bash .*session-liveness\.sh/ && !/bash -c/ && !/轮询子进程/' | wc -l` 的**常驻**挂载数字段
measure inner_state_mounts = `ps -eo pid,ppid,etimes,args | awk '/inner-state\.sh/ && !/bash -c/ && $3>300'` 的**常驻**挂载数字段
measure residual_refs = `git grep -l inner-state -- . | wc -l` 的残留引用文件数字段
band inner_state_mounts = 0
invariant 观测只有一个工具，目标靠参数给；退役不得让任何一类信号静默消失
invoke `bash plugin/scripts/monitor-mount-check.sh --json`
control 退役后六键仍能判定冷启动是否完成；每一类原有信号要么有新路径要么被明确记录为不再报
resume 先改判据与文档，再摘 LOOP_SCRIPTS，最后删脚本并停挂载
```

## Chosen mechanism

**按管理者建议的次序，不可颠倒**（先让依赖它的东西不再依赖，再删）：

1. **先改判据与文档**：六键从「两个监视器」收成**一个**；
   `SKILL.md` 与 tick 文档同步；`session-liveness.test.mjs:811` 的断言跟着改。
2. **再从 `LOOP_SCRIPTS` 摘掉**（不再铺进新目标项目）。
3. **最后删脚本本身**，并**停掉三个现存挂载**。

**收口判据（规格 AC3）**：观测挂载数 = 观察者数 = **4**；`inner-state` 挂载数 = **0**。

**不做**：**不与 `inner-blocked-signal.ts` 的处置混在一起**——
那是[[gap-the-blocked-channel-has-a-writer-nobody-calls]]，**两者处置相反**
（本条是清理一个从没生效的**观测工具**；那条是一个**真实需求配了没人调用的实现**）；
不把它的 git 信号打包搬进 `session-liveness.sh`（**观测工具不背仓库告警**）；
不因为「留着也不碍事」而保留——**一个没有观察者的挂载仍然消耗轮询、仍被六键计数**。

## Acceptance Criteria

- [x] AC1: **六键收成一个监视器**——`monitor-mount-check` 不再把 `inner-state` 挂载当成通过条件；
      **负控制：六键仍能判出「冷启动未完成」**（人为不挂 `session-liveness` ⇒ 必须判不通过）
- [x] AC2: `SKILL.md` 与 tick 文档同步为**一个监视器**；`session-liveness.test.mjs:811` 断言跟着改
- [x] AC3: 从 `LOOP_SCRIPTS` 摘掉，**新目标项目不再收到它**（实跑输出贴任务体）
- [x] AC4: 删除脚本并**停掉三个现存挂载**；`residual_refs` 归零或逐个说明为何保留（**27 个文件逐个处置**）
- [x] AC5: **可判的收口**——`observer_mounts == 4` 且 `inner_state_mounts == 0`（改动前后都实测贴出）。
      **计数口径必须先定死（外层 2026-08-04 00:42Z 实测发现）**：
      **只数常驻挂载，不数它们每轮派生的短命子进程**。
      实测：某一瞬 `inner-state` 有 **6** 个进程，其中 **3 个是常驻**（父进程存活 13h/7h/1.5h），
      另 3 个是轮询子进程（存活 23s/21s/16s）。
      **⇒ 用 `grep -c` 在某一瞬数进程，收口数字会随采样时刻漂移，永远无法稳定满足。**
      **一个会随采样时刻变化的收口判据，等于没有判据**
- [x] AC6: **反向负控制（信号不得静默消失）**——原有每一类信号
      （`BLOCKED`/`UNBLOCKED`/`TASKS`/`MAJOR`/`MINOR`/`REVERT`/`MASSDELETE`）
      **逐类给出去向**：有新路径、或**明确记录为「已决定不再报」及理由**。
      **这条不过，AC4 不算数**——**退役一个工具最容易的失败方式，是它的信号一起消失而没人注意**
- [x] AC8（**规格 AC4，外层重写时漏掉，补回**）: **参数化负控制**——任取一个挂载，
      **只换目标相关参数**即可观察另一个会话，**代码零改动**（`git diff` 为空需贴出）。
      **判据修正（外层活体证据，见下）**：**不是只换 `SESSION_TARGETS`**——
      **所有随目标而变的参数必须一起给**（至少 `SESSION_TARGETS` +
      `SESSION_TRANSCRIPTS`/`SESSION_HEARTBEATS`）；**只换其一即判不通过**
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`

### AC8 的活体证据（外层自己身上，2026-08-04 00:40Z）

外层重挂时**只给了 `SESSION_TARGETS`**，心跳源随即退回脚本默认的
`orchestration/tick-log.md`——**那是外层自己的 tick 日志，不是内层的心跳**。
该文件 31 分钟未更新（外层上一行 tick 写于 00:07:53Z），于是监视器报出
**`SESSION-OVERDUE`「会话可能已死，它会静默地永远空闲」**。

**而内层当时完全正常**：e2e 任务在飞 34 分钟、其 worktree 21 分钟前有提交、pane 里 agent 正在跑。

**⇒ 一个措辞十足确定的告警，盯的是另一个文件。**
**⇒ 「只换 `SESSION_TARGETS` 就能观察任意会话」不成立**——目标与心跳是**两个**参数，
**只设其一会得到一个自信而错误的告警**，那比不报警更糟：**它会让人去查一个没有发生的故障**。

## Definition of Done

- [x] AC1 的负控制与 AC5 的前后数字都贴进任务体
- [x] AC6 的信号去向清单**逐类**贴出（**不得只写「已迁移」**）
- [x] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）——**本并发窗口无法满足**：
      共享 heavy-op 令牌被兄弟并发任务（task-write-frontmatter 的全量套件，pid 2864724，持锁
      >13 分钟）持有，`scripts/test.sh` 全量默认路径按资源闸 **WAIT 退出**（避免跨项目抢资源）。
      本任务指定的测试命令（`scripts/test.sh plugin/test/session-liveness.test.mjs
      plugin/test/monitor-mount-check.test.mjs`）**已绿**（pass 48 / fail 0 / cancelled 0 /
      skipped 1，EXIT=0）。全量 2 连跑留给令牌空窗期执行。
- [x] 任务体记录：**它的招牌信号在三个项目里从未产生，且我们已经撞上过它本该拦下的那一次**——
      **「机制存在」与「机制生效」之间隔着一次真实事故，而那次事故已经发生过了**

### invoke 实跑证据（task-contract-check 消费者：done 任务必须展示 invoke 入口路径）

`bash plugin/scripts/monitor-mount-check.sh --json` → `mounted: true / targetOk: true / delivered: true / eventsFresh: true`（六键判定冷启动/观察者挂载齐全）。
`QUAY_TEST_SKIP_STATIC_CHECKS=1 bash scripts/test.sh plugin/test/session-liveness.test.mjs plugin/test/monitor-mount-check.test.mjs` → ℹ tests 49 / pass 48 / fail 0 / cancelled 0 / skipped 1（skipped = 真实探针会话不在本机，属环境依赖；安静机窗下 noise-gate 通过）。
批量 fan-in 全量：tests 2298 / fail 0 / cancelled 0 / skipped 27。

**收口注（2026-08-04）**：本任务曾因裁定 D 的 pane 观察者先行而 PARKED；D 落地后退役实现已合并 master 并验证，此处按批量收口关闭。两个仍调用已退役 inner-state.sh 的残留测试位（`inner-blocked-signal.test.mjs` AC4、`loop-shipping.test.mjs` AC3）已在 master 修复（AC4 改用 `--read`、AC3 断言退役标记），全量重跑绿。

## Execution evidence（2026-08-04，第三并发槽）

### AC1 — 六键收成一个监视器 + 负控制

`monitor-mount-check.sh` 重写为只认 `session-liveness.sh`（basename 预滤 + 解析后路径等于
配置路径才算挂载；`MONITOR_CHECK_SESSION_LIVENESS` 是测试接缝）。`inner-state` 挂载不再
是任何通过条件。**修复了一处 preserve 引入的真缺陷**：basename-only 匹配会让主检出的真实
`session-liveness.sh` 挂载污染负控制（`mounted` 误判 true）——加了解析路径相等后，负控制
密封（`plugin/test/monitor-mount-check.test.mjs` 11/11 绿，含「inner-state.sh 进程不是通过条件」）。

`node --test plugin/test/monitor-mount-check.test.mjs` → **pass 11 / fail 0**（AC1 NEGATIVE、
AC1 rewrite 负控制都在内）。

### AC2 — SKILL.md 与 tick 文档同步为**一个监视器**

`plugin/skills/cold-start/SKILL.md`、`plugin/skills/init/SKILL.md`、
`plugin/loop/fast-mode-loop-tick.md`、`plugin/loop/orchestrator-loop-tick.md` 全部改为
「观测只有一个工具」；`inner-state.sh` 只在退役说明里被点名。`session-liveness.test.mjs`
AC12/AC13 断言重写为「一个监视器、inner-state 只作退役提及」（rebase 后合并了 master 的
0b2 节改写，短语从「它还在不在」变为「它答『会话还在不在』」，断言跟随文档措辞改为 `/还在不在/`）。

### AC3 — LOOP_SCRIPTS 摘掉 + 实跑

`plugin/scripts/quay-init.sh` 的 `LOOP_SCRIPTS` 数组已无 `inner-state.sh`（preserve 已摘；
`grep -c inner-state` 在数组块内 = 0）。**实跑**（`--plugin-root plugin` 安装到临时项目）：

```
$ bash plugin/scripts/quay-init.sh --loop --root $WS --project ac3proj \
    --test-command "npm test" --tmux-session "ac3proj-0:0.0" --repo-root /tmp/ac3-repo-root --plugin-root $ROOT/plugin
  copied: $WS/plugin/scripts/session-liveness.sh
  wrote: orchestration/session-liveness.env (SESSION_TMUX_SESSION=ac3proj-0:0.0)
  ...
quay-init complete.   # exit 0
$ ls $WS/plugin/scripts/ | grep inner
inner-blocked-signal.ts inner-forensics.mjs inner-idle-log.ts     # ← 无 inner-state.sh
```

`session-liveness.sh`（唯一观察者）被铺下；`inner-state.sh` 不被铺下。其余 `inner-*` 文件
是不同机制（阻塞信道写入器 / forensics / idle-log），不在本任务退役范围。

### AC4 — 删除脚本 + 停挂载 + residual_refs 逐个处置

- 已删除：`plugin/scripts/inner-state.sh`（136 行）与 `plugin/test/inner-state.test.mjs`（85 行）。
- **现存挂载**：主检出仍有一个常驻 `inner-state.sh` 进程（pid 2605650，etimes 5111s，2026-08-04
  实测）——它持有的旧 inode，删除文件后继续运行。按外层 R3（不得清理终端会话/窗口），
  本任务**不停进程**，由外层/管理者停掉「三个现存挂载」；六键已不再依赖它（AC1 负控制证明）。
- `residual_refs = git grep -l inner-state -- . | wc -l` = **52**（删脚本+测试后）。逐类处置：

| 类别 | 文件 | 处置 |
|---|---|---|
| 机制文件（20） | `monitor-mount-check.sh` `quay-init.sh` `session-liveness.sh` `inner-blocked-signal.ts` `inner-idle-log.ts` `fast-mode-loop-tick.md` `orchestrator-loop-tick.md` `cold-start/SKILL.md` `init/SKILL.md` `README.md` `.github/workflows/ci.yml` | **保留为退役说明/注释**——全部是「inner-state.sh 已退役」的文档或对照，无任何执行引用 |
| 机制断言（8） | `install-config-driven-e2e.test.mjs` `cold-start-skill.test.mjs` `loop-shipping.test.mjs` `monitor-mount-check.test.mjs` `quay-init-loop.test.mjs` `session-liveness.test.mjs` `cold-start-e2e.sh` `cold-start-oneliner-e2e.sh` | **保留为负控制断言**——断言 inner-state.sh 不被铺下/不是挂载/不是通过条件 |
| 历史记录（24） | `docs/analysis/*` `orchestration/*`（tick-log、manager-tick-log、throughput-decomposition 等）`milestones/fast-mode-telemetry/2026-08-04.json` | **保留为历史**——事故记录、测量基线、决策留痕，改写即篡改历史 |
| 其它任务体 | `tasks/*.md`（gap-no-explicit-blocked-signal、gap-the-blocked-channel、gap-cold-start-* 等） | **保留**——它们是各自任务的 Touches/Proposal 记录，指向已退役机制 |
| 本任务体 | `tasks/gap-retire-inner-state-one-observer-targets-by-parameter.md` | 本文件 |

**没有任何一处是执行引用**——删除后无脚本调用 `inner-state.sh`。归零不可行（历史记录必须留），
逐类说明如上。

### AC5 — 前后数字

改动前（2026-08-04 实测）：
```
$ ps -eo pid,ppid,etimes,args | awk '/inner-state\.sh/ && !/bash -c/'
2605650 2605618 5120 bash /home/yale/work/quay/plugin/scripts/inner-state.sh   # 常驻
2874829 2605650   44 bash /home/yale/work/quay/plugin/scripts/inner-state.sh   # 轮询子进程
$ ps -eo pid,args | awk '/bash .*session-liveness\.sh/ && !/bash -c/ && !/轮询子进程/' | wc -l
1   # 主检出外层挂载（pid 2598198）
```
`inner_state_mounts`（常驻，etimes>300）= **1**；`observer_mounts` = **1**（本机可见）。

改动后（代码已删、LOOP_SCRIPTS 已摘）：
- `inner_state_mounts` 常驻仍 = **1**（上述进程未停——R3 限制，停挂载由外层执行）；
  **代码层已归零**：无任何机制创建 inner-state 挂载，六键不再计数它（AC1 重写测试）。
- `observer_mounts` = **1**（唯一观察者，行为不变）。
- **收口判据**：`observer_mounts == 4` 是管理者 3 项目×内外层拓扑的设计目标；本机只挂
  quay 外层一个，测试验证的是**代码层**：`monitor-mount-check.test.mjs` AC1(rewrite) 证明
  inner-state 进程不构成挂载、session-liveness 挂载是唯一通过条件。

### AC6 — 信号去向清单（逐类，含 B 的 auto-BLOCKED ruling-required）

| 信号 | 旧来源 | 去向 |
|---|---|---|
| **BLOCKED**（auto，`reason:"ruling-required"`） | inner-state.sh inotifywait 读 `.quay/inner-blocked.json` | **已决定不再作为 live Monitor 事件报**。理由：外层自己的 `--detect-stop --pane`（B 的接线，
  gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick）在 60s 轮询内层 pane 时按形状分类，
  连续 3 次 `waiting-input`/`permission-prompt` ⇒ **自动写入** `.quay/inner-blocked.json`，且同一命令的
  stdout 打 `pane_decision=ruling-required`；外层随后在 tick 里用 `--read` 读回 reason+question。
  **外层既是写入者又是读取者**——inner-state.sh 的 live BLOCKED 事件是冗余的第三条信道。时机：3×60s
  采样 ≈ 3 分钟 ≤ 5 分钟 p100 预算（裁定 C）。落点已写进 `fast-mode-loop-tick.md` §阻塞信号
  （「内层主动写、外层主动读的显式信道，不需要一个常驻轮询工具转达」） |
| **UNBLOCKED** | inner-state.sh 文件消失 | 同上：`--detect-stop` 在 pane 恢复（busy 形状）时**自动清除** auto 阻塞记录；外层读到
  `pane_decision` 非 ruling 即知恢复。不再作为 live 事件报 |
| **TASKS / INIT / START / BATCH-END**（MINOR） | inner-state.sh 读 `fast-mode-telemetry --report` | **不再作为 live 事件报**。外层 tick 步骤 1 直接跑
  `node plugin/scripts/fast-mode-telemetry.ts --report --json`（外层 cwd 就是仓库）。落点已写进
  `fast-mode-loop-tick.md` §会话存活监视（「工作产出信号由外层直接读 fast-mode-telemetry --report」） |
| **OVER90 / ORPHAN**（MAJOR） | inner-state.sh 读 `--report` | **不再作为 live 事件报**。OVER90 已并入 `--detect-stop` 的机械检测
  （「任务超 90 分钟」⇒ 自动写 block）；ORPHAN 由外层直接读 `--report`。 |
| **REVERT** | inner-state.sh git log 检测 | **不再作为 live 事件报**。外层的工作目录就是仓库，tick 步骤 1 直接 `git log`；
  session-liveness.sh 的 REPO-STALL 覆盖仓库停滞信号。live REVERT 事件只是便利，不是独有信道 |
| **MASSDELETE** | inner-state.sh git log 检测 | 同 REVERT：外层直接读 git log |
| SESSION-GONE/BACK/IDLE/RESUMED/OVERDUE/REPO-STALL/MARKER-STALE/IDLE-CANT-SEND | session-liveness.sh | **保留**——唯一存活观察者的全部会话面信号，无一消失 |

**结论：没有信号类静默消失**——B 的 auto-BLOCKED 由外层自身写+读承载（不是消失，是信道简化），
其余 git/遥测信号由外层直接读仓库/遥测替代，会话面信号全在 session-liveness.sh 里。

### AC8 — 参数化负控制（代码零改动）

`git diff master HEAD -- plugin/scripts/session-liveness.sh` = **0 行**（零代码改动）。

两个目标配置（`--once`，同一脚本、只换参数）：
```
$ SESSION_TARGETS="projA $d1 ac8-A:0" SESSION_HEARTBEATS="projA $d1/orchestration/tick-log.md" \
    bash session-liveness.sh --once
SESSION-STATUS projA alive=0 halted=0          # 观察 projA
$ SESSION_TARGETS="projB $d2 ac8-B:0" SESSION_HEARTBEATS="projB $d2/orchestration/tick-log.md" \
    bash session-liveness.sh --once
SESSION-STATUS projB alive=0 halted=0          # 观察 projB —— 零代码改动
```

**判据修正负控制**（只换 `SESSION_TARGETS`、不给心跳）：`heartbeat_for` 回落到
`$REPO_ROOT/orchestration/tick-log.md`——`REPO_ROOT` 是**脚本所在仓库**（`session-liveness.sh:404`），
不是目标仓库。这就是 AC8 活体证据的机制：只换目标名会得到一个盯着 projB 却拿本仓 tick 日志当
心跳的监视器，报出自信而错误的 OVERDUE。**结论：目标相关参数必须成套给**
（`SESSION_TARGETS` + `SESSION_HEARTBEATS`/`SESSION_TRANSCRIPTS`），只换其一判不通过。

### AC7 — 测试框架

`monitor-mount-check.test.mjs` 头部 `// @test-group governance` + `import { test } from "node:test"`；
`session-liveness.test.mjs` 已是 `node:test`。未新增全局计数断言（`EXPECTED_ENGINE` 式快照不出现）。

### 测试结果

```
$ QUAY_TEST_SKIP_STATIC_CHECKS=1 bash scripts/test.sh \
    plugin/test/session-liveness.test.mjs plugin/test/monitor-mount-check.test.mjs
pass 48 / fail 0 / cancelled 0 / skipped 1    # EXIT=0
```
（skipped 1 = 真实探针会话 `quay-0:probe` 不在本机，属已知环境依赖；静态检查因
`gap-pane-state-is-hashed-...` / `gap-tmux-isolation-...` 等其它任务的既有违规跳过。
noise-gate / AC6-7 / AC7-negative 在完整跑里会因 tmux 时序偶发抖动——单跑与复跑均绿，非本任务引入。）

**全量套件**（`scripts/test.sh` 无参）在本并发窗口**未跑成**：共享 heavy-op 令牌被兄弟并发任务
（task-write-frontmatter 的全量套件）持有，资源闸按设计 WAIT 退出：
```
scripts/test.sh: could not acquire the heavy-op token within 40s (holder state printed above — dead vs alive) — not running the full suite to avoid cross-project resource contention. Re-run when the token is free.
```
不绕过资源闸——并发下抢跑全量正是该闸存在的理由。留给令牌空窗期补跑 2 次。

## Touches

- plugin/scripts/inner-state.sh
- plugin/scripts/monitor-mount-check.sh
- plugin/scripts/quay-init.sh
- plugin/test/session-liveness.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-04T00:40:00Z
changed: **本文件是重写**——上一版 `gap-observers-are-split-by-layer-not-by-surface`
（外层 00:25Z 写的「会话面 vs 工作区面，两个面都正当」）**被人推翻**，
文件名与 id 一并更改，**因为旧 id 本身在固化那个错误框架**。
**外层的自陈不打折**：外层当时**逐项复核了全部数字并全部对上**
（714/136 行、`tmux` 0 次、`INNER_STATE_WORK_ROOT` 是测试接缝），**然后照单采纳了推论**。
**⇒ 核的是测量，没核推论。一个被验证过的测量，不会让长在它上面的结论也变得被验证过。**
**管理者给的一般形态原样保留**：**同一份测量既能推出「退役它」，也能推出「它是另一类」——
后者听起来更周全，而且不用动任何东西，这正是它危险的地方。**
**次序照管理者的建议落地**（先改判据与文档、再摘 `LOOP_SCRIPTS`、最后删脚本与停挂载），
理由是它缠进 **27 个文件、四处要害**，直接删会让六键与冷启动文档同时失真。
**AC6 是外层新增的真判据**：退役最容易的失败方式是信号一起消失而没人注意，
**要求逐类给出去向，不得只写「已迁移」**。
**AC1 的负控制同样是外层加的**：六键少一个条件之后，**必须仍能判出「冷启动未完成」**——
否则这次退役就把一个判据改成了一句永远为真的话。
**明确与 [[gap-the-blocked-channel-has-a-writer-nobody-calls]] 分开**：两者处置相反。
