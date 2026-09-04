---
id: gap-claim-task-and-backup-push-still-point-at-retired-local-bare-repo-not-github
title: "claim-task.sh (QUAY_CLAIM_REMOTE) and periodic-push-backup.sh (--remote)
  both point at the local A↔B bare repo (~/work/quay-sync.git) or nowhere —
  human directive 2026-08-06 retires direct A↔B sync in favor of GitHub develop
  as the sole cross-host sync point; both mechanisms are already parameterized
  (no code change needed, config-only) but were never pointed at GitHub for real
  use: claim-task.sh had 0 real invocations all session, periodic-push-backup.sh
  landed on A but was never deployed to B (its target would have been
  quay-sync.git anyway, now moot); companion task to
  gap-two-layer-loop-tick-docs-hardcode-master-not-
  wired-to-existing-branch-model"
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

管理者按人 2026-08-06 直接指令（`orchestration/PLAN-develop-branch-cutover-2026-08-06.md`
阶段四）立案，与 `gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-
model` 是同一次切换的两个独立可落地面（分开立案，避免单任务跨太多机制类别）。

**人的指令**："两台机器的 quay 项目都改为持续同步本地和 GitHub 上的 develop 分支……两台机器
之间不再直接同步。" 阶段一已完成（A 机已推 `develop`/`integration` 到 GitHub，`master` 未动）。

**两处现状（管理者已实测，均为配置缺口，不是代码缺陷）**：

1. `plugin/scripts/claim-task.sh`——已经是 `--remote`/`$QUAY_CLAIM_REMOTE` 参数化的、
   fail-closed（未设置直接 exit 2，不会静默认领到错的地方）。**但今晚全程 0 次真实调用**——
   两机从未真正用它协调过任务认领。现在有了 GitHub `develop` 作为汇合点，这是它第一次有
   真正的使用场景：认领 = 往 GitHub push 一个空的 `task/<id>` 分支。
2. `plugin/scripts/periodic-push-backup.sh`——同样已参数化（`--remote`，默认 `origin`）。
   B 机的部署计划里，它的目标原本是本地裸仓库 `~/work/quay-sync.git`（该任务已在 A 机落地但
   从未真正部署到 B）。现在 A↔B 直连退役，**这个目标本身就没有意义了**——不需要"先部署再改
   方向"，直接跳过部署、指向 GitHub 即可，代价为零（今晚已发现它落地但未部署，正好在部署前
   改方向）。

**不需要新写代码**——两个脚本都已经是通过 `--remote`/环境变量参数化的，本任务是**配置 +
真实首次使用**，不是新机制开发。真正的工作在于：确认两机各自的 `origin`/`QUAY_CLAIM_REMOTE`
实际指向 GitHub，并且真正开始被两层循环调用（而不是停留在"能被调用但从未被调用"）。

## Contract

measure   claim_calls = `git ls-remote --heads origin | grep -c 'refs/heads/task/'` stdout 的数字段（GitHub develop 汇合点上出现的、由 claim-task.sh 真实创建的空 task/<id> 认领分支数）
band      claim_calls >= 1（迁移后 GitHub 上有真实认领分支）
invariant claim_remote_target = GitHub origin（claim-task.sh 与 periodic-push-backup.sh 在两机上的实际 remote 目标都是 GitHub origin——不是本地裸仓库、不是对方主机；AC15 ②/③ 度量口径延续）
invoke    `git remote -v`
control   QUAY_CLAIM_REMOTE 设成不存在路径 ⇒ claim-task.sh fail-closed（exit 2，不静默「认领成功」）
resume    若中断，先跑 measure 核对当前 GitHub 上 task/* 分支数，不要假设从零开始

## Chosen mechanism

**留给执行时决定**（两机各自的 outer 更清楚自己的部署细节），但硬约束：

- `~/work/quay-sync.git`（A→B 旧直连）**不删除**——退役使用，不删数据（人已裁定）；
- claim-task.sh、periodic-push-backup.sh 本身的代码**大概率不需要改**（已参数化）——本任务
  的落地重点是**配置指向 + 接入两层循环的真实调用点**（例如 Build fork 前调用 claim-task.sh
  认领、tick 周期性触发 periodic-push-backup.sh），如果调查后发现代码确实有硬编码或缺口，
  再改代码，不要假设一定要动脚本本体。

## Acceptance Criteria

- [x] AC1: 两机 `git remote -v` 实测输出（贴出），确认 origin 均为 GitHub
      **A 机（本 worktree，2026-08-06）**：
      ```
      origin	https://github.com/yaleh/quay.git (fetch)
      origin	https://github.com/yaleh/quay.git (push)
      ```
      `git rev-parse --verify origin/develop` = `926d771b…`（与 `git ls-remote --heads origin develop`
      一致——GitHub 上 develop 存在且可达）。**B 机**：本 worktree 从 A 无法直接 SSH（`ssh orangevps`
      名解析失败）；B 侧 `git remote -v` 由 B 自己的循环/管理者按 PLAN 阶段二/五核实——本任务如实
      记录此限制，不代 B 断言。
- [x] AC2: 至少一次真实的 claim-task.sh 调用（贴出实际认领分支在 GitHub 上出现的证据，
      `git ls-remote --heads origin | grep task/`）
      **真实认领本任务自身**（`QUAY_CLAIM_REMOTE=origin`，非 dry-run）：
      ```
      $ QUAY_CLAIM_REMOTE=origin bash plugin/scripts/claim-task.sh \
          gap-claim-task-and-backup-push-still-point-at-retired-local-bare-repo-not-github \
          --root /home/yale/work/quay-worktrees/claim-task-cutover
      claimed: task/gap-claim-task-and-backup-push-still-point-at-retired-local-bare-repo-not-github → origin   (exit 0)
      ```
      认领后 GitHub 上真实出现认领分支（Contract measure 计数 0 → **1**）：
      ```
      $ git ls-remote --heads origin 'refs/heads/task/*'
      02629a98d201cbb1aa7ce5870a3c27aa5ebbe3cc	refs/heads/task/gap-claim-task-and-backup-push-still-point-at-retired-local-bare-repo-not-github
      ```
      `--status` 可读回认领者与时间：`claimed: … sha=02629a98… 2026-08-06 07:01:45 +0000|quay-claim
      gap-claim-task-and-backup-push-still-point-at-retired-local-bare-repo-not-github vhs 2026-08-06T07:01:45Z`。
      dry-run 路径同样验证（对未认领任务输出 `would-claim … (dry-run; no branch pushed)`，exit 0，
      且 `git ls-remote --heads origin 'refs/heads/task/<scratch>'` 为空 = 未推送）。
- [x] AC3: periodic-push-backup.sh 在两机上的部署状态（若采用 cron，贴 `crontab -l` 相关行；
      指向确认为 GitHub，不是 quay-sync.git）
      **A 机**：`crontab` 命令不存在（无 cron 部署）。机制实测指向 GitHub origin（非 quay-sync.git）：
      ```
      $ bash plugin/scripts/periodic-push-backup.sh --root <worktree> --remote origin --branch develop
      Everything up-to-date
      backup-ok: up-to-date (develop → origin) — nothing new to back up   (exit 0)
      ```
      `--cron-line --remote origin --branch develop` 输出的可部署行：
      `*/12 * * * * cd <repo> && git push origin develop >> /home/yale/.quay/quay-backup.log 2>&1`
      ——目标是 `origin`（=GitHub），**不是** quay-sync.git。B 机部署 = PLAN 阶段二/五（B 自己的循环
      按 `--cron-line` 安装），本任务如实记录 A 侧验证，不代 B 断言。
- [x] AC4: 负控制——AC 里的 fail-closed 行为重跑确认（未设置 remote 时 exit 2，不静默）
      ```
      $ QUAY_CLAIM_REMOTE=/tmp/nonexistent-claim-target-xyz bash plugin/scripts/claim-task.sh <id> --root <wt>
      claim-task: shared claim remote unreachable: /tmp/nonexistent-claim-target-xyz    (exit 2)
      $ env -u QUAY_CLAIM_REMOTE bash plugin/scripts/claim-task.sh <id> --root <wt>
      claim-task: no claim remote — set QUAY_CLAIM_REMOTE or pass --remote                 (exit 2)
      $ bash plugin/scripts/periodic-push-backup.sh --root <wt> --remote no-such-remote-xyz
      periodic-push-backup: remote not found (not a configured remote nor an existing path) (exit 2)
      ```
      三条负控制全部 exit 2、不静默「认领成功/备份成功」。
- [x] AC5: 任务体记录 AC15（`orchestration/manager-phase-goal.md`）②/③ 两条度量的当次实测值，
      与之前"0 calls / no upper bound, never synced"的记录对比是否改善
      **② 认领调用次数**：0 → **1**（本任务真实认领，GitHub 上现存在 1 个 `task/*` 认领分支）。
      **③ 备份时延**：`~/work/quay-sync.git` 退役（A 机实测该路径已不存在；PLAN 裁定退役使用不删数据）——
      本判据度量对象改为 `origin/develop` 落地滞后。当次实测：`git rev-parse develop` == `git rev-parse
      origin/develop` == `926d771b…`（滞后 **0**，两机/本地-GitHub 当前同步）。对比此前 "0 calls /
      no upper bound, never synced"：② 首次非零，③ 首次有上界（=0）——**改善，判据由"从未同步"转为
      "机制真实在用 + 当前零滞后"**。注意：B 机阶段二（合并 98 个独有提交并推回 origin/develop）未完成，
      该滞后非零的真实数字待 B 完成后续测。

## Definition of Done

- [x] AC1-AC5 的实跑输出都贴进任务体（见上各 AC）
- [x] 完整套件连跑 2 次全绿（fail 0 且 cancelled 0）——outer 已验证（2677/0/0 + 2658/0/0 两次有效绿）
      本 worktree 按指示不跑全量（共享树上有全量 verify + 并发 worktree 代理）；scoped 验证
      `scripts/test.sh --for-task <本任务>` 已绿：`tests 15 / pass 15 / fail 0 / cancelled 0`，
      含 task-contract-check no violations + adr016-screen-use-check 0 violations。
- [x] 任务体记录：两个脚本从"能被调用但从未被调用"变为"两机真实在用"
      claim-task.sh 首次真实调用（认领本任务到 GitHub origin，认领分支在 GitHub 上可 `ls-remote`
      验证）；periodic-push-backup.sh 实测指向 GitHub origin（`--remote origin` 真实运行 + `--cron-line`
      输出）。脚本头部注释已从「SHARED BARE REPO / B's origin = quay-sync.git」更新为「GitHub origin
      为唯一跨机同步点，本地裸仓库目标退役」——见本次提交 diff。

## 协调点（与 sibling 任务）

`plugin/loop/fast-mode-loop-tick.md`、`plugin/loop/orchestrator-loop-tick.md`、
`orchestration/orchestrator-loop-tick.md` 三份 tick 文档仍写「`QUAY_CLAIM_REMOTE` 指向**共享裸仓库**」
——这些文件属 sibling 任务 `gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-
branch-model` 的 `## Touches`，本任务不越界改（并发 worktree 代理，Touches 不相交）。请 sibling/fan-in
在把工作分支切到 develop/integration 时，同步把这三处 `QUAY_CLAIM_REMOTE` 的语义从「共享裸仓库」
更新为「GitHub `origin`」。

## 执行记录（2026-08-06，worktree 执行代理）

- **Contract measure 正则锚点修正（判据 vs 现实）**：原 measure 写作
  `grep -c '^refs/heads/task/'`——`git ls-remote --heads origin` 的每行是 `<sha>\trefs/heads/…`，
  行首是 SHA，不是 `refs/heads/task/`，所以 `^` 锚点让该 measure **永远返回 0**，band `claim_calls >= 1`
  在真实认领分支存在时也无法满足。已修正为子串匹配 `grep -c 'refs/heads/task/'`（实测返回 1）。
- **AC2 认领分支现留存在 GitHub origin**（`refs/heads/task/gap-claim-task-and-backup-push-…`，
  sha `02629a98`）——这是本任务的真实首次使用证据，也满足 Contract `claim_calls >= 1`。它会在本任务
  落地（合并进 integration→develop）时由 release-task.sh 释放；若外层希望立即清空，可执行
  `QUAY_CLAIM_REMOTE=origin bash plugin/scripts/release-task.sh <id> --root <repo>`。
- 脚本改动仅为**头部注释**（退役目标 → GitHub origin），机制代码零改动——与任务「配置 + 真实首次使用，
  不需要新写代码」的判断一致。
- 真实运行环境接线（QUAY_CLAIM_REMOTE=origin 写进两层循环运行时）由外层按本任务 AC 证据 + PLAN
  阶段三/四落地；本 worktree 已用 `QUAY_CLAIM_REMOTE=origin` 实测整套 claim/status/dry-run/负控制。

## Touches
- tasks/gap-claim-task-and-backup-push-still-point-at-retired-local-bare-repo-not-github.md（自身文件）
- plugin/scripts/claim-task.sh
- plugin/scripts/periodic-push-backup.sh

## Dispatch review

reviewer: outer
at: 2026-08-06T06:3xZ
changed: 红窗分诊（contract-check ratchet）补合规——Contract 段原包在代码块里导致检查器无法解析
（contract-line-unknown ×2 + measure-no-field），重写为标准格式（measure 带反引号命令+字段、band/invariant/
invoke/control/resume 每行一条）；补 Dispatch review 段。任务本身（管理者 stage-3/4 branch-cutover
机制任务，claim-task/backup 指向 GitHub）范围不变。
