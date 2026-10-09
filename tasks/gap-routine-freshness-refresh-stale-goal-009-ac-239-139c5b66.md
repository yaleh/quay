---
id: gap-routine-freshness-refresh-stale-goal-009-ac-239-139c5b66
title: "freshness-refresh: evidence_ts 2026-09-25T16:27:01Z is 322.71h old and
  d=217 > K=200 (margin -17); note the AC-239 leg has no standalone command —
  its only refresh path is the AC-2"
status: done
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
evidence_ts 2026-09-25T16:27:01Z is 322.71h old and d=217 > K=200 (margin -17); note the AC-239 leg has no standalone command — its only refresh path is the AC-238 run, and a PARTIAL run refreshes AC-238 while leaving AC-239 on the old reading

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1791515642323` · ts `2026-10-09T03:14:02.323Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`GOAL-009-AC-239`
- 涉及文件：
- `plugin/freshness-producers.json`
- `.quay/productization-verification.jsonl`
- `.quay/goal-freshness-margin.json`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run upgrade-face on host B and verify the run is a full UPGRADE-PAIR (not PARTIAL), since AC-239 ages out only when that run succeeds

## Disposition

**结论（一句话）**：AC-239 的 remedy **当下产不出记录** —— 失败点已按位置定位到 **AC-238 腿的升级动作**
（`plugin/scripts/verify-deliver-coldstart.sh:1456`：把 CLI 入口 `plugin/bin/quay` 当脚本调、**缺 `init` 子命令**，
`e0279c77a`/2026-10-07 引入的调用点迁移回归）。⛔ 不是「跑得太慢」、⛔ 不是探针没触发、⛔ 也不复是 2026-09-25 那次
挡住 remedy 的 ssh/磁盘前置（那两条本次逐条复核均通过）。⇒ 失败位置从「跨机前置」搬到了「升级动作」。

### ① 复核读数（载体本体，⛔ 不引述 finding 散文）

- `.quay/productization-verification.jsonl` 中 `ac=GOAL-009-AC-239` 共 **7** 条，**最新**一条：
  `ts=2026-09-25T16:27:01Z` / `host=orangevps` / `build_sha=09f5c3a80893` / `project_root=/home/yale/quay-verify-upgrade-09f5c3a8-root`
  ⇒ finding 的 `evidence_ts` **逐字复现**（硬规则 2 的零计数配套动作：谓词对真样本命中）。
- 同一次运行的 AC-238 腿最新记录也是 `ts=2026-09-25T16:27:01Z` / `build_sha=09f5c3a80893` —— 与 AC-239 **同一 root、同一 build**
  ⇒ 2026-09-25 那一次是一条**完整 UPGRADE-PAIR**（符合 `_ac239_refresh_shape` 说的「AC-239 只在 AC-238 的**成功**方向上与之耦合」）。
- **两腿自 2026-10-09 起的记录数均为 0**（`ts >= 2026-10-09` ⇒ AC-238:0 / AC-239:0）
  ⇒ 2026-10-09T03:14 那次 remedy 真的跑了、且**一条都没产出**。
- `.quay/goal-freshness-margin.json`（2026-10-09T03:57:30Z）：`GOAL-009-AC-238` 与 `GOAL-009-AC-239` 均
  `d=218 / margin=-18`（`evidence_age_hours=323.51`）。

### ② AC-239 没有独立命令 —— 按位置复核（⛔ 不按关键词）

- ⑦b 的调用点 = `verify-deliver-coldstart.sh:8808`（`step_upgrade_drive_continue "$ROOT"`），嵌在同文件 `:8800` 的
  `if [ "$UPGRADE_EXISTING" = 1 ]` 内；`UPGRADE_EXISTING=1` 只由 `:619` 的 `--upgrade-existing` 置位。
- `--ac239-e2e` 在 `plugin/scripts/develop-deliver-tgz.sh` 里的读数点只有 `:273`（解析）、`:1778`、`:1857`
  —— 三处都在 `verify_upgrade_mode` 函数体内（不带 `--verify-upgrade` 时静默落回默认交付路径，⛔ 不产 AC-239 记录）。
- ⇒ **不存在「只刷新 AC-239」的命令**；AC-239 的唯一刷新路径 = 同时带 `--verify-upgrade` 与 `--ac239-e2e` 的
  `upgrade-face` 运行。finding 的那条「note」**成立**（它在 `plugin/freshness-producers.json._ac239_refresh_shape` 里
  另有一份机器可核的版本）。⚠️ 该文档的**行号**是 2026-09-24 取的，与上面本次读数差约 4 行；**位置结论不变**。

### ③ 失败在哪一步 —— 主证据 + 双侧对照（⛔ 都是本次亲自取的读数）

**(a) 生产失败的现场**（本次直接 `ssh` 读 host B 上 2026-10-09T03:47Z 那次运行的产物，⛔ 不是引述别人的转述）：

```
$ ssh -o BatchMode=yes yale@orangevps.wan.hwang.men 'cat …/quay-verify-upgrade-cdbe3483-root/.quay-upgrade-init.log'
usage: quay <adr|goal|meta|init|task list|…|driver> ...
Run `quay --help` for full usage documentation.          （wc -l = 2，全文就是这两行）
```

同一次运行的远端日志 `.quay/verify-upgrade-remote-B-cdbe3483.log` 逐字节选：

```
upgrade action: shipped quay-init (config-preserving branch) rc=1 → …/.quay-upgrade-init.log
post: tasks=103 taskset_stable=1 runtime_replaced=0
AC-238 record NOT written — 缺值≠合格 (… upgrade_init_rc=1)
== ⑦b post-upgrade continuation (AC-239) ==
  not-evaluated: AC-238 未在【这个 root】上评估通过（evaluated=0 …）⇒ ⛔ 不写 AC-239 记录
AC238_EVALUATED=0 … AC239_EVALUATED=0 … AC239_WRITTEN_THIS_RUN=0
VERIFY-RC 0    EVIDENCE-LINES 2        （只追加了 ac89 + ac201）
```

**(b) 根因的双侧对照**（本次亲自跑；只改**一个**变量；用生产所调的那个入口 `plugin/bin/quay`）：

| 对照 | argv | 结果 |
|---|---|---|
| ① 复现（= 生产所跑的 argv，即 `verify-deliver-coldstart.sh:1455-1457`） | `bash <wt>/plugin/bin/quay --root X --repo-root X --worktree-root X-wt --adopt-branch-model --auto-commit-skip` | 打印与 (a) **逐字相同**的两行 usage，**rc=1** |
| ② 只加 `init` 一个词 | `bash <wt>/plugin/bin/quay init --root X … --auto-commit-skip` | **越过参数解析**（rc=0，真的 scaffold 出闭集七件） |

⇒ ① 逐字复现生产失败；② 改变**唯一**一个变量后失败消失 ⇒「缺 `init` 子命令」是**成因**，不是相关物（硬规则 4 推论四的对照已给出）。

**(c) 引入点（按位置）**：`plugin/scripts/verify-deliver-coldstart.sh:1386` 把 `qinit` 设为
`${npmroot}/quay/plugin/bin/quay` —— **CLI 入口，要求第一个位置参数是子命令**；而 `:1455-1457` 的调用仍按
shell-入口时代的形态传 flags ⇒ `--root` 被当成 verb ⇒ 未知 verb ⇒ usage ⇒ rc=1。⛔ 与 flags 本身无关。

### ④ 本任务⛔未做的事（逐条，不以沉默代替）

- ⛔ **未重跑完整跨机产出者**。理由（⛔ 不是省事）：**同一条注册命令**（逐字见 `producers[].command`）
  **已在本日 03:14–03:47Z 由派发链真跑过一次**（证据 = ① 的「两腿自 2026-10-09 起记录数均为 0」+ ③(a) 的主日志），
  失败是 **argv 级的、确定性的**（③(b) 对照①已证），而 `:1456` 在**当前 develop tip 逐字未变**
  ⇒ 重跑只能复现同一读数、不产生任何新信息（硬规则 4b/4 推论四：外部状态相同 ⇒ 结果相同）。
  本任务把 22m49s 的跨机预算换成了**同一条链上更省的两步**：直接读生产现场（③a）+ 亲自跑双侧对照（③b）。
- ⛔ **未改 `plugin/scripts/verify-deliver-coldstart.sh`**（**不在 Touches**）：这是 `e0279c77a` 的不完整调用点迁移，
  **同形态共 2 处**（硬规则 5b）—— 除 `:1456` 外还有 `:4583` 的 `step2_init`（冷启动面 ② 段，其参数字面量里带
  `--all/--loop` 这类**非 CLI flag**，修法与 `:1456` **不同形**）。该文件是 `--selfcheck` + 31 个用例钉住的产品脚本
  ⇒ 归 `e0279c77a` 的所有者或一次新的**机制**任务，⛔ 不由本 gap 任务扩面代裁。
- ⛔ **未另立修复任务**（沿本 family 既有约定，同 `…-ac-238-79f43e79` 的 ⑧）。⚠️ 但这里留一条**可核的现场读数**给接手者：
  板上**没有任何 open 任务的正文**提到 `verify-deliver-coldstart.sh` 或 `qinit`
  （本次按位置扫 `tasks/*.md` 非 done 者，命中 **0**；同一谓词对全量扫得 **104** ⇒ 谓词对已知真样本命中，零计数可信）
  ⇒ **这个回归当下无主**。
- ⛔ 未改 `plugin/freshness-producers.json`（Touches 里那一行）：逐项复核结论**正确、无需变更** ——
  `subjects` 含 AC-238/AC-239 两条、`command` 已带 `--ac239-e2e`、`_ac239_refresh_shape` 已把 finding 那条
  「note」写成机器可核版本。⛔ 把运行史写进该文件本身就违反它自己的单源原则。
- ⛔ 未改 `goals/`、未改 K、未改 criterion/expect、未改探针；未删载体里任何记录。

### ⑤ 观察项（⛔ 无发生率读数者不得升为前置 —— 硬规则 12）

1. **失败位置搬家**：`…-ac-239-upgrade-face-8c2414da`（2026-09-25）立案时 remedy=`blocked`（ssh 授权被拒）；
   本次实测 remedy **可执行**（ssh rc=0；隔离副本 `cp -a` 成功）而失败落在**升级动作** ⇒ 「remedyAvailability=executable」
   与「remedy 当下能产出记录」在 `e0279c77a` 之后**不再同形**。⚠️ 该形态 `…-ac-238-79f43e79` 的 ⑧-3 已单独登记，
   本任务只留读数、⛔ 不重复立案。
2. **回归的影响面不止本主体**：`:4583`（同簇）是**冷启动面** ② 段 ⇒ 它同时挡住 `coldstart-face`/`session-delivery` 的
   5 个主体（AC-201/203/205/207/232）。本次证据：同一次 remedy 的 ① 段仍为 AC-201 写出了一条合格记录
   （`ac201 record appended`）⇒ 7 个受管主体里**唯一**能靠本运行刷新的是 AC-201，且原因是它在升级动作**之前**。
   ⚠️ n=1，只记观察。
3. **板上有一颗并行的同源任务**：`gap-routine-freshness-refresh-stale-goal-009-ac-201`（status `ready`）同为本次
   scan-round 立案 —— 它走的是**另一条** producer（coldstart-face）。⛔ 本任务不代它处置、也不假设它的结论。

**轴状态**：本任务无代码 delta（未改 `plugin/scripts/**`），故 L_D/L_G 未测；本节 ①③ 的读数即本次交付。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-239`（routine `freshness-refresh`，runId `freshness-refresh-1791515642323`）所描述的问题被复核并处置 —— 复核 = ① 载体本体逐字复现 finding 的 `evidence_ts`/`build_sha`，并用「两腿自 2026-10-09 起记录数均为 0」证明 2026-10-09T03:14 那次 remedy 一条都没产出；② 按位置复核 finding 的那条「note」（AC-239 无独立命令）；处置 = ③ 把失败点按位置钉死在 AC-238 腿的升级动作（`verify-deliver-coldstart.sh:1456`，缺 `init` 子命令），并给出主证据（host B 生产现场日志，本次亲读）与双侧对照（本次亲跑）。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **未修掉**（修法与 Touches 不符，见 ④），但**已在管机制与失败步都已写明并可被第三方重跑**：机制 = `upgrade-face` producer（`subjects=[AC-238,AC-239]`，命令带 `--ac239-e2e`）+ 例程 `freshness-refresh`；失败步 = ⑦ 的升级动作（`upgrade action: … rc=1` ⇒ `AC238_EVALUATED=0` ⇒ ⑦b `not-evaluated` ⇒ 不写 AC-239 记录）。根因 = 调用点回归 `e0279c77a`：`verify-deliver-coldstart.sh:1386` 的 `qinit` 是 CLI 入口，而 `:1456` 仍按 shell-入口形态调用、缺 `init`；对照①逐字复现 rc=1、对照②只加 `init` 即越过参数解析。兄弟位点 `:4583` 同形态且当下**无主**（④）。

## DoD
- [x] 上面的判据实跑通过 —— 复核读数取自**载体本体**（`.quay/productization-verification.jsonl` 与 `.quay/goal-freshness-margin.json`，均 `python3` 解析后逐字打印）；失败现场取自 host B 上本次运行自己的 `.quay-upgrade-init.log`（`ssh` 直读，2 行）与远端汇总日志；根因用双侧对照当场跑出（对照① rc=1 / 对照② rc=0）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 探针那一侧本次 scan-round 逐字 `FILE-ONLY: no producer was executed`，其职责止于立案；产出者的**执行**已由派发链在本日 03:14–03:47Z 完成（载体与远端日志为证），本任务（派发链一侧）负责的是复核与处置。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-239-139c5b66.md`