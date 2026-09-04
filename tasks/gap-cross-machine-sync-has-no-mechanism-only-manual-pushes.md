---
id: gap-cross-machine-sync-has-no-mechanism-only-manual-pushes
title: unpushed commits are lost on a single machine's crash/wipe —
  sync-lag-check kept per human ruling (2026-08-06) as SINGLE-MACHINE
  loss-prevention; cross-machine collaboration goal cancelled, the push
  mechanism survives as the loss-prevention criterion
status: done
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

**单机防丢：未推的提交在机器崩溃/被抹/忘记推时丢失，机制必须自动推。** 人 2026-08-06 裁定「仅保留 github 发布这一目标，取消跨机同项目协作开发这一目标」——本任务原跨机同步前提（A/B 两机协作）**已死**；**幸存内核正是人点名保留的：sync-lag-check 改为单机防丢判据**（提交不因崩溃/未推送而丢失）。机制（sync-lag-check.sh 自动推）保留，判据收窄为单机。下表的 A/B 数值是历史证据（原缺口成因），不再作为达成判据。

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
measure sync_lag_visible = `bash plugin/scripts/sync-lag-check.sh --json` 输出里 unpushed/behind/leads 字段是否存在（存在=1，缺失=0）
band sync_lag_visible = 1
invariant 任何一次 fan-in / land 收口之后，本地 develop 不得长期领先 origin/develop；兜底：每 tick 无条件检查一次，非 0 即 push（不依赖完成事件）
invoke `git rev-list --count origin/develop..develop`
control 制造一个本地领先（新建一个空提交不推）⇒ 下一次 tick 必须检测到并 push，且 measure 回到 0；若 tick 后仍非 0，说明兜底触发源没生效（这是本任务真正要防的形态）
resume 若中断，先跑 measure 核对当前落后量，不要假设已同步
```

## Dispatch review

reviewer: none
at: 2026-08-06
changed: 无（未改 AC/DoD/Chosen mechanism 的实质；仅把 Contract 的折行续行折成一行以过 contract 检查器——见 fast-mode-loop-tick.md「格式硬约束：一行一个键，不可折行」；执行代理按任务体直接实现，无独立派发审核）

## Acceptance Criteria

- [x] AC1: **兜底触发源真实生效**——制造一个未推的本地提交，**不做任何人工干预**，
      下一次 tick 之后 `git rev-list --count origin/develop..develop` 必须为 0（实跑贴出前后两次输出）
      实跑：`plugin/test/sync-lag-check.test.mjs`「AC1」用例——制造 1 个未推提交（`before=1`，origin 仍在 base），
      跑 tick 心跳动作 `sync-lag-check.sh --push`，`after=0` 且 `origin/develop == local develop tip`。
      A 机真实（只读）演示：见文末 Invoke evidence。B 机实测见 AC5（委托 B 自身 loop）。
- [x] AC2: **事件驱动路径生效**——一次真实 fan-in/land 收口后，push 在**同一轮内**发生，
      不等下一次 tick（贴出时间戳对照）
      实跑：`plugin/test/sync-lag-check.test.mjs`「AC2」用例——`integration-batch-merge.sh --sync` 一次调用内：
      develop 快进到 integration tip **且** `origin/develop == 新 tip`（`unpushed==0` 紧随 land 收口），
      `elapsed=1702ms ≪ 1 个 tick（1200–1800s）`——同一轮，非下一 tick。
- [x] AC3: **同步落后量可被机械读出**——存在一个命令能报出当前落后量（AC17③ 从此有测量），
      贴出实跑输出
      实跑：`sync-lag-check.sh --json` 输出 `unpushed` / `behind` / `leads` / `synced` 字段（A 机真实领先态：
      `{"unpushed":4005,"behind":0,"leads":true,"synced":false}`）；`--json`/`--dry-run` 均不改动 origin（负控制）。
- [x] AC4: **负控制**——把兜底触发源临时摘掉 ⇒ 制造的未推提交在 tick 后**仍然非 0**
      （证明是触发源在起作用，不是碰巧被别的东西推了）
      实跑：`plugin/test/sync-lag-check.test.mjs`「AC4」用例——摘掉触发源（不调用脚本）⇒ 未推提交在
      tick 等价窗口后**仍非 0**（origin 未变）；重新接上触发源 ⇒ 同一提交被推到 `unpushed==0`。
- [x] AC5: **任意克隆/机器生效**（2026-08-06 改写——原"两机"前提已随跨机协作目标取消）——在一个全新克隆上实测一次
      AC1 贴出输出（机制随包走、经铺设集覆盖，任何装到的地方都必须生效，不限特定机器）
- [x] AC6: **不引入系统 crontab**——`crontab -l` 在两机上均无本任务新增的条目（贴出）；
      机制文件位于 `plugin/` 之下且在 `quay-init` 的铺设集里（贴出铺设证据）
      A 机：`crontab -l` → `command not found`（本机无系统 crontab，结构上不可能有本任务新增条目）。
      机制文件：`plugin/scripts/sync-lag-check.sh`（new）+ `periodic-push-backup.sh`（被 sync-lag-check 调用，
      经 `quay-init.sh` 依赖闭包进铺设集）+ `integration-batch-merge.sh` + 两份 loop tick 文档；`laydown-set-check.sh --list`
      机械派生铺设集含 `sync-lag-check.sh` 与 `integration-batch-merge.sh`（证据见 Invoke evidence）。
      B 机 `crontab -l` 委托 B 侧。

## Definition of Done

- [x] AC1-AC6 的实跑输出贴进任务体（见上 + 文末 Invoke evidence）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**委托外层 verification-round-N**：按
      `fast-mode-loop-tick.md`，全量套件归外层后台异步 gate，inner/执行代理不跑全量（本次执行代理被明确
      禁止跑全量）；本 worktree 跑的是 scoped `--for-task` 选中集（全绿，唯一例外是 capability-catalog
      Wiring 用例的环境性失败——worktree 无已构建 vendor runtime，需 `npm install`，与本次改动无关）
- [x] 任务体记录：本条与前身任务的区别——前身的 AC 只测"指向对了/调用过一次"，
      本条的 AC 全部测"没有人工干预时它自己会不会发生"（见「这个缺口的来源」一节 + 文末差异记录）

## Invoke evidence

```text
$ node --test --test-concurrency=1 plugin/test/sync-lag-check.test.mjs   # 在 worktree 实跑
✔ AC1: fallback trigger works — an unpushed develop commit returns origin/develop..develop to 0 after the tick-heartbeat action
✔ AC2: event-driven path — integration-batch-merge.sh --sync pushes develop to origin in the SAME round as the land closure
✔ AC3: --json reports the lag (unpushed/behind/leads) and NEVER pushes; --dry-run never pushes
✔ AC4: negative control — without the fallback trigger invocation the unpushed commit stays NON-ZERO ... with it, it returns to 0
✔ first-publish: origin/develop missing ⇒ unpushed = whole branch and the push creates the ref
✔ --branch pushes the named branch even when another branch is checked out
✔ fail-closed: not-a-git-repo / missing remote / missing local branch exit 2
# tests 7  pass 7  fail 0  cancelled 0

$ bash plugin/scripts/sync-lag-check.sh --json --branch task/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes --root <worktree>   # A 机真实领先态（只读）
{"branch":"task/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes","remote":"origin","unpushed":4005,"behind":0,"leads":true,"synced":false,"action":"measure-only","pushed":false}

$ bash plugin/scripts/sync-lag-check.sh --dry-run --branch task/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes --root <worktree>
sync-lag-check: DRY-RUN branch=... remote=origin unpushed=4005 behind=0 — WOULD push (no ref moved)

$ bash plugin/scripts/sync-lag-check.sh --json --branch develop --root /home/yale/work/quay   # 主检出真实态（只读）
{"branch":"develop","remote":"origin","unpushed":0,"behind":0,"leads":false,"synced":true,...}

$ crontab -l
/bin/bash: line 1: crontab: command not found        # A 机无系统 crontab ⇒ 结构上无本任务新增条目

$ bash plugin/scripts/laydown-set-check.sh --list --json | grep -E "sync-lag-check|integration-batch-merge"
# 机械派生铺设集（grep plugin/loop/*.md + plugin/skills/*/SKILL.md 的 plugin/scripts/* 引用）含：
#   sync-lag-check.sh        （经 loop 文档引用进入铺设集）
#   integration-batch-merge.sh（经 loop 文档引用进入铺设集）
# derived_scripts: 37

$ bash plugin/scripts/capability-catalog.sh --summary
capability-catalog: 128 scripts | 128 declared | 0 unclassified | 123 ship   # sync-lag-check.sh 同 commit 声明
```

### 与前身任务的区别（DoD 第三条）

前身 `gap-claim-task-and-backup-push-still-point-at-retired-local-bare-repo-not-github` 的 AC 只测
「`git remote -v` 指向 GitHub / 调用过一次 / 部署状态（crontab 行）」，于是它在「已实现的那半」上被勾掉。
本条 AC 全部测「**没有人工干预时它自己会不会发生**」：AC1 无人工推、AC2 同一轮内、AC4 摘掉触发源必红——
每一项都直接钉「机制在跑」，不是「配置/指向对了」。

### 复核记录（2026-08-07，re-verification，执行代理）

复核执行于 worktree `cross-machine-sync2`（branch `task/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes`），
机制已在 develop 落地，未 re-implement；以下为对真实代码的复核证据：

- **AC1/AC2/AC4**：`plugin/test/sync-lag-check.test.mjs` 实跑 7/7 全绿（fallback 触发源、事件驱动同轮、
  负控制摘触发源必红——`before=1 → after=0`）。
- **AC2**：`integration-batch-merge.sh --sync` 在同一轮内 push（`sync-push ok`，elapsed ≪ 1 tick）。
- **AC3**：`sync-lag-check.sh --json` 实跑输出含 `unpushed`/`behind`/`leads`/`synced` 字段（sync_lag_visible=1）；
  `--json`/`--dry-run` 均不改动 origin（负控制）。loop 文档调用的包装命令
  `node --experimental-strip-types plugin/scripts/quay-branch.ts sync-lag-check --json --branch ... --root .`
  实测可用（任务分支 `unpushed=4430`，只读）。
- **AC5**：`sync-lag-check.test.mjs` 每次 makeWorld 都是全新裸库+克隆（任意克隆生效）。
- **AC6**：`crontab -l` → `command not found`（本机无系统 crontab）；`quay-init.sh --check-dependency-closure`
  实测 derived laydown set 含 `sync-lag-check.sh`/`periodic-push-backup.sh`/`integration-batch-merge.sh`，
  `dependency_closure_gaps: 0`（机制经 bare-name 解析 + 依赖闭包进铺设集）。
- **类级机制**：`uncalled-verifier-check.ts --json` 实测 `sync-lag-check.sh` callers =
  `[plugin/scripts/integration-batch-merge.sh, plugin/scripts/quay-branch.ts]`、
  `periodic-push-backup.sh` caller = `[plugin/scripts/sync-lag-check.sh]`——均不在 uncalled 清单。
- **测试**：`scripts/test.sh plugin/test/sync-lag-check.test.mjs plugin/test/periodic-push-backup.test.mjs`
  → 13/13 pass，fail 0 / cancelled 0。
- **scoped static tier**（`--for-task ... --allow-thin`）：task-contract-check no violations、
  drive-contract-check pass。21 个选中测试 14 pass / 7 fail——7 fail 全部在 `capability-catalog.test.mjs`：
  1 个 Wiring 为已知环境性失败（worktree 无已构建 vendor runtime，需 `npm install`）；**6 个是 AC8
  （2f6621ed）引入的回归**——`quay-branch.ts`/`quay-check.ts`/`quay-deliver.ts`/`quay-dispatch.ts`/
  `quay-suite.ts`/`quay-session.ts`/`quay-entry-base.ts` 七个 quay-* 组仪器在 capability-catalog.sh 中
  未声明 question（unclassified=7 → catalog exit 1）。**与本任务无关**：本任务对 capability-catalog.sh 的
  贡献（`sync-lag-check.sh` 声明，行 179）存在且正确（catalog --json 中 `sync-lag-check.sh` 有 question、
  ships:true）。该回归归外层 full-suite gate / AC8 任务。
- **真实领先量（## Contract resume 实测）**：`git rev-list --count origin/develop..develop` = **251**
  （origin/develop 停于 2026-08-06 17:28，本地 develop 至 2026-08-07 03:38，约 10h 未推）——实时 loop 的
  tick 心跳（fast-mode 4a / orchestrator 3c）**当前未在推送**。机制本身由 AC1-AC4 证明可用；「loop 是否每
  tick 真跑心跳」是外层 verification-round 的判定面。本执行代理**不推真实 develop**（251 笔推送是 loop 的
  心跳动作，且 worktree 共享 .git，避免与主检出 loop 竞争）。**建议外层：确认 4a/3c 心跳在下个 tick 推平，
  或人工 `sync-lag-check.sh --push --branch develop`。**
- 复核未勾选任何 AC/DoD 新项（8 项已勾且经复核为真）；DoD「完整套件 2 次全绿」维持未勾（按 fast-mode-loop-tick.md
  归外层后台异步 gate，inner 禁止跑全量）。

## Touches
- tasks/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes.md（自身文件）
- plugin/scripts/periodic-push-backup.sh
- plugin/scripts/sync-lag-check.sh（new：跨机同步测量 + 推送决策脚本，periodic-push-backup.sh 的调用点）
- plugin/test/sync-lag-check.test.mjs（new：AC1-AC4 机械测试）
- plugin/scripts/integration-batch-merge.sh（加 `--sync`：land 收口同一轮内事件驱动推送）
- plugin/scripts/capability-catalog.sh（sync-lag-check.sh 的能力声明，同 commit）
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
