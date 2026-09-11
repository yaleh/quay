---
id: gap-aged-third-party-project-quay-upgrade-verification
title: 升级路径验证：真实旧痕迹第三方项目（meta-cc 副本）能否被当前 develop tip 干净接管
status: todo
labels:
  - gap
parent: null
children: []
extra:
  goal_ac: AC-238
goal_ac: AC-238
---
## Finding

2026-09-11 会话实测（orangevps ssh 外部可核）：`orangevps:/home/yale/work/meta-cc` 是一个真实跑过
quay-native 约一个月的第三方 Go 项目——102 个真实任务文件（88 done / 14 todo）、32KB 的
`gate-events.jsonl` 真实历史、`loop-state.json` 停在 iteration 21（`lastCompleted: DIR-080`,
2026-07-30）。其 `.quay/runtime/bin/{quay,quay-native,quay.js,quay-native.js}`（gitignored,不进 git）
是 **2026-08-20 23:00-23:22** 打包的旧 "vendored bundle" 形态（shell wrapper 指向绝对路径 +
esbuild 单文件打包），**早于 2026-09-02 落地的 `SPEC-plugin-lifecycle-single-bundle-2026-09-02.md`**——
meta-cc 从未经过新的 single-bundle 交付路径。

meta-cc 早就当过一次真实第三方验证靶子并反哺过发现（`git log -- .quay` 里的
`25abb0a config: default_task_status ready→todo (AC118 third-party verification — ready-trap found in the wild)`）,
本仓库对应的 `gap-ac118-third-party-project-verification` / `gap-ac119-webui-cross-project-verification` /
`gap-delivery-surface-grows-but-target-freezes-no-upgrade` / `gap-the-runtime-has-nowhere-safe-to-land` /
`gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them` 全部 `status: done`,时间点都对齐在
2026-08-20 前后（正是 meta-cc 那次安装的产物）——**这条线索自 8/20 起没人回来复验过**。

GOAL-009（"交付面端到端自证——从 build 到 driver 驱动第三方项目开发的闭环"）现有 9 条 AC
（AC-201/202/203/204/205/206/207/232/234）的证据全部来自**全新 `quay-init` 的一次性项目**
（如 orangevps 上的 `a2a5aac0-root`）,没有一条覆盖"升级一个带旧版本痕迹、有真实存量数据的既有项目"
这个场景——而 GOAL-009 自己的背景原文就是拿 meta-cc 当第三方验证靶子。为此已新建
`goals/AC-238-...md`（挂在 GOAL-009 下,status: active,criterion 已跑出确定的 fail,非"未评估"）,
本任务是承接该 AC 判据所需真实证据的执行体。

## Proposal

**What/Why**：在 orangevps 上做一份 meta-cc 的**隔离副本**（⛔ 不碰真实活项目的 102 个任务和真实
backlog）,用当前 develop tip 现 build 的交付物对该副本执行"既有旧痕迹项目"形态的升级/接管
（不是空仓库 `quay-init`）,measure 升级前后的任务存量是否一致、旧 vendored runtime 是否被真实替换、
新 CLI 能否正确读出旧库,并按 AC-207 先例的纪律把真实产出的记录取回本机、追加进
`.quay/productization-verification.jsonl`（`ac: "GOAL-009-AC-238"`）,复跑 AC-238 判据以其退出码为准。

**Approach**：

1. 在 orangevps 上建副本（如 `cp -r ~/work/meta-cc ~/quay-verify-upgrade-metacc` 或对本地检出
   `git clone` 到新目录）,记录升级前状态：任务文件数（`ls tasks/*.md | wc -l`）、
   `.quay/runtime/bin/*` 的 mtime（换算成 `pre_upgrade_runtime_age_days`）。
2. 用当前 develop tip 现 build 的交付物,对该副本执行"目标已有 `.quay/config.yml` + 真实 `tasks/`"
   形态的升级路径——**先验证现有 `quay-init` / `develop-deliver-tgz.sh --verify-coldstart` 流程
   面对一个非空目标时的真实行为**（是安全跳过既有文件、报错、还是静默覆盖？这本身就是本 AC 要回答
   的一部分,不要预设答案）,必要时扩展 `plugin/scripts/develop-deliver-tgz.sh` /
   `plugin/scripts/verify-deliver-coldstart.sh` 增加一条"目标已有存量数据"的路径。
3. 升级后测量：`quay task list` 对副本给出的任务条数等于 `pre_upgrade_task_count`
   （即 `post_upgrade_task_count`）；旧 `.quay/runtime/bin/*` 已被本次真实交付物替换
   （`runtime_replaced: true`,非旁路共存）；抽样 `task_get` 几个升级前就存在的真实任务
   （如 `DIR-001`）,内容与升级前一致（`task_list_ok: true`）。
4. 在**远端**追加一条真实 JSON 记录到该项目那次跑产出的 evidence 路径,字段至少包含：
   `ac: "GOAL-009-AC-238"`, `host`, `project_root`, `pre_upgrade_task_count`,
   `post_upgrade_task_count`, `pre_upgrade_runtime_age_days`, `runtime_replaced`,
   `task_list_ok`, `build_sha`。按 AC-207 文件里"执行说明：跑成功之后必须把证据取回家"一节的三条纪律：
   只 grep 取回这一条新记录、去重追加进本机 `.quay/productization-verification.jsonl`、
   然后复跑 AC-238 判据确认真的翻绿——⛔ 不得手写/注入这条记录,⛔ 不以"跑完了"自称为准。
5. 若升级路径过程中暴露真实缺陷（例如 `quay-init` 不安全地覆盖了既有 `tasks/`、旧字段
   `default_task_status` 与新版不兼容、runtime bundle 没被干净替换而是残留共存等）,
   另开一条独立的 gap/finding 任务承接该缺陷,不要在本任务里把它悄悄修掉或略过。

**Out of scope**：不改动 orangevps 上 meta-cc 的真实活项目（只用副本）；不在本任务里处理
orangevps 磁盘 94% 满、6 组孤儿 `ac207-*` driver 进程未清理的问题（那是独立的场外发现,值得关注但不是
本任务范围）。

## Touches

- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `tasks/gap-aged-third-party-project-quay-upgrade-verification.md`

## Plan

Stage 1 — 副本与基线：在 orangevps 上建 meta-cc 隔离副本,记录 `pre_upgrade_task_count` 与
`pre_upgrade_runtime_age_days`。验证：两个数都是从副本实际读出的直接量,而非估计。

Stage 2 — 升级路径执行：搞清楚现有升级/接管流程面对"已有 `.quay/` + 真实 `tasks/`"目标的真实行为,
必要时扩展 `develop-deliver-tgz.sh` / `verify-deliver-coldstart.sh`。验证：副本上 `.quay/runtime/bin/*`
的内容/mtime 与升级前不同（真的换了,不是没跑到）。

Stage 3 — 升级后度量：`post_upgrade_task_count == pre_upgrade_task_count`；抽样 `task_get` 核对内容
一致；`runtime_replaced` / `task_list_ok` 两个布尔量都基于实际读数,不是假设。

Stage 4 — 证据取回：追加真实记录到本机 `.quay/productization-verification.jsonl`（去重、只搬这一条）,
复跑 AC-238 判据,以其退出码为准记录真实结果（翻绿或如实记录仍 fail 并说明卡在哪一步）。

Stage 5 — 缺陷分流：若发现真实缺陷,另立任务,本任务的 DoD 不含"缺陷已修完",只含"缺陷已被另立任务追踪"。

## Acceptance Criteria

- [ ] meta-cc 的隔离副本（非活项目本体）已在 orangevps 上按当前 develop tip 完成"既有旧痕迹项目"
      形态的升级/接管
- [ ] 升级前后任务文件数一致（`post_upgrade_task_count == pre_upgrade_task_count`，均为实测直接量）
- [ ] 旧 `.quay/runtime/bin/*`（2026-08-20 vendored bundle）已被本次真实交付物替换，而非旁路共存
- [ ] 升级后 `quay task list` / `task_get` 能正确读出旧存量任务的真实内容，不仅仅是文件还在磁盘
- [ ] 按 AC-207 先例的"取回本机"纪律：真实产出的记录被 grep 取回、去重追加进本机
      `.quay/productization-verification.jsonl`，且复跑 AC-238 判据以其退出码为准
      （⛔ 不以"跑完了"自称为准）
- [ ] 若升级路径暴露真实缺陷，已另开 finding/gap 任务承接，未在本任务里掩盖或悄悄修掉

## DoD

- [ ] AC-238 判据复跑后有一个明确、可核的退出码结果（翻绿，或如实记录仍为 fail 并说明卡在哪一步——
      不得静默搁置不复跑）
- [ ] 若发现新缺陷，已另立任务追踪，且本任务描述中链接了该任务 id
- [ ] `extra.goal_ac: "AC-238"` 已随 task_write 写入并读回核对
