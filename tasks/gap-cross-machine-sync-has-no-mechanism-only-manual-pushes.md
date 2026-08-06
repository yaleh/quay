---
id: gap-cross-machine-sync-has-no-mechanism-only-manual-pushes
title: "cross-machine sync has NO mechanism — both A and B accumulated unpushed work
  (A 26, B 98) and B fell 405 behind over ~6h, discovered only because the human
  looked; periodic-push-backup.sh ships but has ZERO live callers (grep in
  plugin/loop/*.md + all SKILL.md = 0), and AC17's sync-lag criterion has ZERO
  mechanical measurement; the earlier task that should have covered this was marked
  done on ACs that only checked 'the remote points at GitHub' and 'it was invoked
  once' — AC text narrower than the problem, ticked off on the implemented half
  (2nd instance of the AC6 failure shape, and the manager wrote those ACs)"
status: todo
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**跨机同步没有机制，只有"人或管理者想起来才推一次"。** 人 2026-08-06 亲自发现并裁定立案。

### 实测（不是推测）

| 项 | 值 |
|---|---|
| A 未推提交 | **26**（推送前实测；人下令后已推） |
| B 未推提交 | **98**（今天全部工作，只存在于 B 本地磁盘） |
| B 落后 `origin/develop` | **405** |
| B 上次与 GitHub 交互 | **07:09**，此后约 6 小时既没拉也没推 |
| 双方改动文件交集 | **56**（A 改 238 / B 改 117，共同祖先 `d85ae594`） |
| `periodic-push-backup.sh` 的活调用方 | **0**（`grep` 全部 `plugin/loop/*.md` + 所有 `SKILL.md` 零命中） |
| AC17③（同步时延上界）的机械测量 | **0**——全部 shipped 脚本里没有任何东西在测它 |

**两次大分叉（今天上午 105 提交、下午 98/405）都不是判据发现的，是人亲眼看到 B 一直在跑任务才问出来的。**

### 这个缺口的来源：一条 `done` 任务交付的不是机制

`gap-claim-task-and-backup-push-still-point-at-retired-local-bare-repo-not-github` 状态 `done`，
五条 AC 全勾，但**没有一条要求"周期性地、自动地推"**：

- AC1 两机 `git remote -v` 指向 GitHub —— 配置核对
- AC2 `claim-task.sh` **一次**真实调用 —— 一次性证明
- AC3 `periodic-push-backup.sh` **部署状态**（贴 crontab 行）—— 状态记录
- AC4 fail-closed 负控制 —— 既有行为回归
- AC5 AC15 度量的**当次实测值** —— 一次快照

任务标题是"still point at retired local bare repo"（**指向**错了），所以它只修了指向。
**这完全符合它自己的 AC——问题在 AC 的文本跨度小于问题跨度，于是在已实现的那半上被勾掉。**

**这是本仓第二次犯同型错误**（`manager-phase-goal.md` 记过 AC6 的第一次）。
**且那条任务是管理者立的、AC 是管理者写的**——管理者当时明确写了"配置 + 真实首次使用，不是新机制开发"，
自己把范围定小了。本任务的 AC 因此**刻意写成机械可测的形态**，不再写"确认指向对了"这类。

## Chosen mechanism

**复用本仓已验证的 `slot-refill` 双触发源模式，不新发明**（人 2026-08-06 早前已裁定此方向，
且明确禁止用系统 crontab——理由见下）：

- **事件驱动（加速）**：`develop` 前进时（fan-in / land 收口后）立即 push；
- **tick 心跳（兜底必跑）**：每 tick 无条件问一次本地 `develop` 是否领先 `origin/develop`，
  领先即 push。

**不得用系统 crontab**（人已裁定）：crontab 行不随包走（不在铺设集/bundle/升级通道）、
在所有既有检查之外、是产品之外的第二个调度源、且结构性不可移植。
机制必须活在 `plugin/loop/` + `plugin/scripts/` 里，随包走、走升级通道、被铺设集覆盖。

具体接哪个钩子、push 失败如何重试/降级、是否复用 `periodic-push-backup.sh` 本体，
**留给执行时决定**（它已经参数化，大概率不用改代码，缺的是调用点）。

## Contract

```
measure unpushed_after_tick = `git rev-list --count origin/develop..develop` 的数字字段（一次 tick 收口后测）
band unpushed_after_tick = 0
measure sync_lag_visible = `bash plugin/scripts/<同步检查脚本> --json` 输出里同步落后量字段是否存在（存在=1，缺失=0）
band sync_lag_visible = 1
invariant 任何一次 fan-in / land 收口之后，本地 develop 不得长期领先 origin/develop；
  兜底：每 tick 无条件检查一次，非 0 即 push（不依赖完成事件）
invoke `git rev-list --count origin/develop..develop`
control 制造一个本地领先（新建一个空提交不推）⇒ 下一次 tick 必须检测到并 push，
  且 measure 回到 0；若 tick 后仍非 0，说明兜底触发源没生效（这是本任务真正要防的形态）
resume 若中断，先跑 measure 核对当前落后量，不要假设已同步
```

## Acceptance Criteria

- [ ] AC1: **兜底触发源真实生效**——制造一个未推的本地提交，**不做任何人工干预**，
      下一次 tick 之后 `git rev-list --count origin/develop..develop` 必须为 0（实跑贴出前后两次输出）
- [ ] AC2: **事件驱动路径生效**——一次真实 fan-in/land 收口后，push 在**同一轮内**发生，
      不等下一次 tick（贴出时间戳对照）
- [ ] AC3: **同步落后量可被机械读出**——存在一个命令能报出当前落后量（AC17③ 从此有测量），
      贴出实跑输出
- [ ] AC4: **负控制**——把兜底触发源临时摘掉 ⇒ 制造的未推提交在 tick 后**仍然非 0**
      （证明是触发源在起作用，不是碰巧被别的东西推了）
- [ ] AC5: **两机都生效**——A 与 B 各自实测一次 AC1，贴出各自输出
      （只在 A 上生效不算达成——本缺口正是"B 侧没有"）
- [ ] AC6: **不引入系统 crontab**——`crontab -l` 在两机上均无本任务新增的条目（贴出）；
      机制文件位于 `plugin/` 之下且在 `quay-init` 的铺设集里（贴出铺设证据）

## Definition of Done

- [ ] AC1-AC6 的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录：本条与前身任务的区别——前身的 AC 只测"指向对了/调用过一次"，
      本条的 AC 全部测"没有人工干预时它自己会不会发生"

## Touches
- tasks/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes.md（自身文件）
- plugin/scripts/periodic-push-backup.sh
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
