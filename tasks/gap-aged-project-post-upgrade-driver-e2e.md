---
id: gap-aged-project-post-upgrade-driver-e2e
title: 升级后闭环验证：driver 在已升级的旧痕迹项目（meta-cc 副本）上继续驱动新任务到 done
status: todo
labels:
  - gap
parent: null
children: []
extra:
  goal_ac: AC-239
depends_on:
  - gap-aged-third-party-project-quay-upgrade-verification
goal_ac: AC-239
---
## Finding

2026-09-11 人裁定：`gap-aged-third-party-project-quay-upgrade-verification`（挂 `goal_ac: AC-238`）
原定范围里悄悄混了两类不同的失败点——"升级机制本身是否丢数据"和"升级完之后 driver 还能不能正常干活"——
一条判据里塞两件事,出问题时分不清是升级本身坏了还是 driver 坏了。已拆成两条独立 AC：

- **AC-238**（不变）：升级机制本身——数据不丢（`pre_upgrade_task_count == post_upgrade_task_count`）、
  旧 vendored runtime 被真实换掉（`runtime_replaced=true`）、新 CLI 读得出旧存量（`task_list_ok=true`）。
  这是静态/存量维度。
- **AC-239**（新，本任务对应的那条）：动态维度——升级完之后,目标项目**自己的** `*-drivers` 能不能
  像 GOAL-009 已 achieved 的 AC-207 那样,继续驱动出一条**新**任务到 done、留下真实 git 提交。
  GOAL-009 现有 9 条 AC 里,AC-207 证明了"全新初始化的项目上 driver 能驱动出真实提交",但从没有一条
  AC 证明"一个刚被从旧版本升级过来的项目,driver 是否还能正常继续干活"——这正是 AC-239 要补的空白。

AC-239 的判据刻意设计成**必须与 AC-238 的通过记录关联**（同一个 `project_root`）,不是接受一个自报的
`post_upgrade: true` 字段——防止有人绕过真实升级、另起一个全新项目冒充"升级后"来蒙混过关。这意味着
**本任务在时间上依赖 `gap-aged-third-party-project-quay-upgrade-verification` 先把 AC-238 跑出通过记录**
（同一个 project_root 上的升级副本必须先真实存在且升级成功）,已用 `depends_on` 表达这个先后关系。

## Proposal

**What/Why**：在 `gap-aged-third-party-project-quay-upgrade-verification` 已经把 meta-cc 副本升级成功
（AC-238 通过）之后,**在同一个 project_root 上**新建一条真实任务,让该项目自己的 `*-drivers` 把它驱动到
done,产出真实 git 提交,并把这次的证据记录（`ac: "GOAL-009-AC-239"`,同一个 `project_root`）追加进
`.quay/productization-verification.jsonl`,复跑 AC-239 判据确认翻绿。

**Approach**：

1. 确认 `gap-aged-third-party-project-quay-upgrade-verification` 已完成、AC-238 已有通过记录、
   目标副本（project_root）确实存在且处于升级后的状态。
2. 在该副本项目里,用 quay-native 的 task/goal ABI 新建一条简单、可机械验收的任务（参照 GOAL-009 已有
   e2e 先例 `task_id: e2e-verify-207` 的做法,比如加一个可核实的文件/标记）。
3. 启动或复用该项目自己的 promotion/worker drivers（不是本仓库的 drivers）,让它们把这条新任务驱动到
   done,机械 fan-in、写下真实 gate-event。
4. 从**远端**（该副本所在主机）取得真实的 `commit_sha`、`task_id`、`task_status`、`gate_events` 计数、
   `produced_by_driver` 判定,追加一条记录到远端的 evidence 路径,只 grep 取回这一条新记录（`ac` 字段
   必须是 `"GOAL-009-AC-239"`,`project_root` 必须与 AC-238 通过记录里的那个完全一致）,去重追加进本机
   `.quay/productization-verification.jsonl`——⛔ 不得手写/注入,⛔ 不以"跑完了"自称为准。
5. 复跑 AC-239 判据,以其退出码为准记录真实结果。
6. 若发现真实缺陷（比如升级后的项目 driver 起不来、profiles 配置丢失、旧任务残留导致新任务派发被卡住等）,
   另开独立的 gap/finding 任务承接,不在本任务里掩盖。

**Out of scope**：不重做 AC-238 已经验证过的静态/存量维度；不碰 orangevps 上 meta-cc 的真实活项目
（只用 `gap-aged-third-party-project-quay-upgrade-verification` 建的那份副本）。

## Touches

- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `tasks/gap-aged-project-post-upgrade-driver-e2e.md`

## Plan

Stage 1 — 前置核实：确认 `gap-aged-third-party-project-quay-upgrade-verification` 已 done 且 AC-238
已有通过记录，取得其 `project_root`。

Stage 2 — 建新任务并驱动：在该 project_root 上新建一条任务，让该项目自己的 drivers 驱动到 done，
产出真实 git 提交与 gate-event。

Stage 3 — 证据取回：远端 grep 取回真实的这一条新记录（`ac=GOAL-009-AC-239`，`project_root` 与 AC-238
通过记录一致），去重追加进本机 `.quay/productization-verification.jsonl`，复跑 AC-239 判据，以退出码
为准记录结果。

Stage 4 — 缺陷分流：若过程中发现真实缺陷，另立任务承接，本任务 DoD 不含"缺陷已修完"，只含
"缺陷已被另立任务追踪"。

## Acceptance Criteria

- [ ] 已确认 `gap-aged-third-party-project-quay-upgrade-verification` 完成、AC-238 有通过记录，
      取得其 project_root
- [ ] 在该 project_root 上，目标项目自己的 `*-drivers` 驱动出一条新任务到 done，真实 git 提交存在
- [ ] 真实产出的记录（`ac=GOAL-009-AC-239`，`project_root` 与 AC-238 通过记录一致，`commit_sha`/
      `task_id` 非空，`task_status=done`，`gate_events>0`，`produced_by_driver=true`）已取回本机
      `.quay/productization-verification.jsonl`
- [ ] AC-239 判据复跑后有明确、可核的退出码结果（翻绿，或如实记录仍为 fail 并说明卡在哪一步）
- [ ] 若发现新缺陷，已另开 finding/gap 任务承接，未在本任务里掩盖或悄悄修掉

## DoD

- [ ] AC-239 判据复跑后有明确结果，不得静默搁置不复跑
- [ ] 若发现新缺陷，已另立任务追踪，且本任务描述中链接了该任务 id
- [ ] `extra.goal_ac: "AC-239"` 与 `depends_on: ["gap-aged-third-party-project-quay-upgrade-verification"]`
      已随 task_write 写入并读回核对
