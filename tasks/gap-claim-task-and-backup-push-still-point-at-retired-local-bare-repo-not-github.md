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
status: ready
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

measure   claim_calls = `git ls-remote --heads origin | grep -c '^refs/heads/task/'` stdout 的数字段（GitHub develop 汇合点上出现的、由 claim-task.sh 真实创建的空 task/<id> 认领分支数）
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

- [ ] AC1: 两机 `git remote -v` 实测输出（贴出），确认 origin 均为 GitHub
- [ ] AC2: 至少一次真实的 claim-task.sh 调用（贴出实际认领分支在 GitHub 上出现的证据，
      `git ls-remote --heads origin | grep task/`）
- [ ] AC3: periodic-push-backup.sh 在两机上的部署状态（若采用 cron，贴 `crontab -l` 相关行；
      指向确认为 GitHub，不是 quay-sync.git）
- [ ] AC4: 负控制——AC 里的 fail-closed 行为重跑确认（未设置 remote 时 exit 2，不静默）
- [ ] AC5: 任务体记录 AC15（`orchestration/manager-phase-goal.md`）②/③ 两条度量的当次实测值，
      与之前"0 calls / no upper bound, never synced"的记录对比是否改善

## Definition of Done

- [ ] AC1-AC5 的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录：两个脚本从"能被调用但从未被调用"变为"两机真实在用"

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
