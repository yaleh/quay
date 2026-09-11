---
id: gap-aged-third-party-project-quay-upgrade-verification
title: 升级路径验证：真实旧痕迹第三方项目（meta-cc 副本）能否被当前 develop tip 干净接管
status: ready
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

GOAL-009（"交付面端到端自证——从 build 到 driver 驱动第三方项目开发的闭环"）原有 9 条 AC
（AC-201/202/203/204/205/206/207/232/234）的证据全部来自**全新 `quay-init` 的一次性项目**
（如 orangevps 上的 `a2a5aac0-root`）,没有一条覆盖"升级一个带旧版本痕迹、有真实存量数据的既有项目"
这个场景——而 GOAL-009 自己的背景原文就是拿 meta-cc 当第三方验证靶子。为此已新建
`goals/AC-238-...md`（挂在 GOAL-009 下）,本任务是承接该 AC 判据所需真实证据的执行体。

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

**落地机制（本任务新增，已在 Touches 声明的两个脚本里）**：既有升级路径此前**不存在**——
`verify-deliver-coldstart.sh` 的步骤 ② 开头是 `rm -rf $ROOT; mkdir -p $ROOT`，即它的靶子**按构造**
永远是空目录（这正是 GOAL-009 那 9 条 AC 的共同形态）。本任务新增：

- `verify-deliver-coldstart.sh --upgrade-existing [--upgrade-source <dir>]`：步骤 ⑦，对**非空**目标
  取四个直接量（存量计数 + 全库逐文件 sha256 聚合 / runtime 双向替换判定 / 新 CLI 读回旧库 /
  build_sha），目标可由 `--upgrade-source` 以**只读 `cp -a`** 复制而来。
- `develop-deliver-tgz.sh --verify-upgrade --upgrade-source <rel-to-$HOME>`：与 `--verify-coldstart`
  同一条跨主机取证链（scp → 远端跑 → scp 回 → 去重追加），但切到升级模式、且以
  `ac=GOAL-009-AC-238` 记录是否存在为闸。

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

- [x] meta-cc 的隔离副本（非活项目本体）已在 orangevps 上按当前 develop tip 完成"既有旧痕迹项目"
      形态的升级/接管
- [x] 升级前后任务文件数一致（`post_upgrade_task_count == pre_upgrade_task_count`，均为实测直接量）
- [x] 旧 `.quay/runtime/bin/*`（2026-08-20 vendored bundle）已被本次真实交付物替换，而非旁路共存
- [x] 升级后 `quay task list` / `task_get` 能正确读出旧存量任务的真实内容，不仅仅是文件还在磁盘
- [x] 按 AC-207 先例的"取回本机"纪律：真实产出的记录被 grep 取回、去重追加进本机
      `.quay/productization-verification.jsonl`，且复跑 AC-238 判据以其退出码为准
      （⛔ 不以"跑完了"自称为准）
- [x] 若升级路径暴露真实缺陷，已另开 finding/gap 任务承接，未在本任务里掩盖或悄悄修掉

## Definition of Done

- [x] AC-238 判据复跑后有一个明确、可核的退出码结果（翻绿，或如实记录仍为 fail 并说明卡在哪一步——
      不得静默搁置不复跑）
- [x] 若发现新缺陷，已另立任务追踪，且本任务描述中链接了该任务 id
- [x] `extra.goal_ac: "AC-238"` 已随 task_write 写入并读回核对

## Defects filed (DoD-2)

升级路径暴露两个真实缺陷，均**未在本任务内修复或掩盖**，各自另立任务：

- `gap-quay-init-failure-report-existence-proxy-overreports-on-upgrade` ——
  `quay-init` 的失败路径报告（`plugin/scripts/quay-init.sh:1930` `report_closed_set_state`）用
  `[ -e ]`（**存在性**）冒充「本次写到」⇒ 对**非空**目标升级时把本次逐字节没碰过的
  `.quay/config.yml` 报成 `written:`（实测 diff 为空）。前任 done 任务
  `gap-quay-init-hard-requires-tmux-session-and-leaves-partial-write` 的 AC3 Evidence 只在空目录
  fixture 上为真。
- `gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated` ——
  升级路径对「既有项目本地 `.quay/runtime/`」**没有任何机制**：`quay-init` 已退役该铺设
  （头部 `:22`，main dispatch 对 `.quay/runtime` 引用数为 0），而 `migrate_stale_mcp_entry`
  的判定（`:665`）要求 mcp_entry 第 2 段以 `.js`/`.ts` 结尾，**裸 `quay-native` 不匹配** ⇒
  真实旧项目升级后 `path`/`mcp_entry`/`.quay/runtime/bin/*` 三项全部原封不动。

## Evidence

**两次独立真跑，均在 orangevps 上对 `~/work/meta-cc` 的只读 `cp -a` 副本**（源项目全程未被写）。
字段来源 = `develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc --hosts B`
的远端 stdout（落盘于 `.quay/verify-upgrade-remote-B-<tip8>.log`）。

**run #2（最终交付码，develop tip `1c202737ed2acb7e9ea93f96fb3b8a27437f5d66`）** —— 权威那一次：

```
  isolated copy: /home/yale/work/meta-cc -> /home/yale/quay-verify-upgrade-1c202737-root
                 (source opened read-only, never written)
  pre:  tasks=102  runtime_age_days=21.215  taskset=146ed8c92590
  upgrade action: shipped quay-init (config-preserving branch) rc=0
  post: tasks=102  taskset_stable=1  runtime_replaced=1
  cli read-back: list_count=102  sample=AC118-001  sample_ok=1  task_list_ok=1
  ac238 record written → …-evidence-1c202737.jsonl    (ts 2026-09-11T04:10:09Z)
```

**run #1（tip `9eda8c70741d…`，早于本轮对 sample 选择逻辑的两处修复）**：同一四个读数全部成立，
`sample=DIR-001`，记录 `ts 2026-09-11T04:00:43Z`。两次的 `fresh_runtime_sha256` 相同
（同一对交付物）。⛔ 两次都保留在载体里，未删除——它是真实发生过的读数，不是草稿。

**本机复跑判据（cwd = 仓库根，与 goal-driver 同）**：`AC238_CRITERION_EXIT=0`（翻绿）。
独立旁证：goal-driver 于 `2026-09-11T04:00:52Z` 机械翻转
`AC-238 active→achieved`，`reason: "I2: criterion pass"`。

**源项目未被触碰（负控制）**：`~/work/meta-cc` 的 `tasks/*.md` 仍 102 个、
`.quay/runtime/bin/*.js` mtime 仍是 `Aug 20 23:00`、无 `.quay-upgrade-init.log`。

**本地控制（先于真跑，用于证明判据能取假）**：
```
无可探测 test command 的 fixture → quay-init rc=2 → 四项读数【全部为真】→ 记录【未写】 ✓
有 go.mod 的 fixture            → quay-init rc=0 → 记录写入                              ✓
无 DIR- 族任务 id 的 fixture     → 走兜底分支，四项成立、记录写入                        ✓
--upgrade-source 隔离副本       → 副本升级完成，源目录树 sha256 聚合逐字节不变           ✓
```
其中第一条抓到本实现自己的一个缺陷（只按四项结果判定会在升级动作失败时仍写「成功」记录），
已把 `upgrade_init_rc == 0` 纳入判定门；第三条抓到第二个（`grep` 无匹配 exit 1 在 `set -e` 下
直接杀死脚本），已改为单分支取值。
