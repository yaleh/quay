---
id: gap-e2e-verify-pushes-dev-host-profile-model-to-target-host
title: --ac207-e2e / --ac239-e2e 把开发机 .quay/profiles.yml 原样 scp 给目标主机，其 worker
  模型名（本机网关专属）在 host B 上被拒 ⇒ AC-207/AC-239 两条腿 worker 全死、记录不产出，且无覆盖入口
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal
<!-- dedup-ref -->相关已完成任务（仅追溯，机制不同）：gap-ac257-verify-leg-misses-declared-worker-env（--verify-ac257 腿不下发声明的 worker 环境，另一条腿）、gap-ac207-e2e-target-driver-driven-real-commit-task-done（AC-207 e2e 的引入）、gap-ac214-ac238-239-freshness-upgrade-producer-rerun（上一次成功重跑 upgrade-face）；已 superseded：gap-fix-worker-spawn-inherits-unrecognized-model-deepseek-v4-pro-anthropic（同一类 unrecognized_model 现象，但那是 promotion-driver 自己 spawn 的本机路径，不是向目标主机推送）。按机制查重：`grep -l "quay-driving-profiles\|--driving-profiles" tasks/*.md` 无任何任务以「推送侧无覆盖入口」为机制。

**问题（直接量，2026-09-25）**：`plugin/scripts/develop-deliver-tgz.sh` 在 `--ac207-e2e`（约 :1585）与 `--ac239-e2e`（约 :1744）两处，把驱动方仓库的 `${repo_root}/.quay/profiles.yml` 逐字 scp 到目标主机 `~/quay-driving-profiles.yml`，远端 `resolve_driving_profiles` → `configure_target_profiles` 由它派生目标项目 worker-default 的 launcher/model/auth。**推送侧没有任何覆盖入口**：`grep -c -E 'target-model|target-launcher|target-auth' plugin/scripts/develop-deliver-tgz.sh` = 0，而远端 `verify-deliver-coldstart.sh:615-617` 早已支持 `--target-launcher/--target-model/--target-auth`（「CLI 覆盖 > 驱动方派生」），只是驱动脚本从不转发。
**症状**：本仓 `.quay/profiles.yml` 的 worker-default.model 自 `cfed5fd14`（2026-09-23）起是 `v4.1flash-anthropic`（仅本机网关 127.0.0.1:26510 认得）。2026-09-25 对 host B（orangevps）重跑两条 producer：upgrade-face 的隔离副本 `.quay/profiles.yml:15` 含该模型名，副本内 worker-driver 于 11:10:59Z 自停（`halted_by: worker-driver:environment-fatal`，签名 `unrecognized_model {"model":"v4.1flash-anthropic"}`），AC-239 未产出；coldstart 的 `e2e-verify-207` 于 12:45–12:48Z 连续 4 次 `API Error: 400 Invalid model name passed in model=v4.1flash-` 后被重试上限翻 needs-human，远端脚本随后空等 `AC207_POLL_SECS`（develop-deliver-tgz.sh:1593 导出 3600s）。B 自己的 `claude` 进程用的是 `deepseek-v4-flash-anthropic`。
**因果状态（诚实标注）**：以上与时间线一致（载体末批成功证据 2026-09-20，早于 09-23 的模型名改动），但【尚未被反事实检验】——检验就是 AC4 里「换成 B 认得的模型名再跑一次」。在 AC4 通过前，这是假说，不是结论。

**做法**：给驱动脚本一个【驱动方本地】的 profile 来源覆盖入口（推荐 `--driving-profiles <本地路径>`，与远端脚本同名 flag；亦可用环境变量），未指定时行为与现状逐字节相同（仍用 `${repo_root}/.quay/profiles.yml`），指定时两处 scp 都改用它；指定路径不存在 ⇒ NOT-EVALUATED + 非零退出，⛔ 不回落到开发机 profile（硬规则 3b：读不懂输入不得伪装成合格）。⛔ 不在脚本里写死任何模型名（硬规则 4 推论二：写死的主机专属字面值换台机器就变成静默限制）；用哪个模型名由运行者提供一份目标主机认得的 profile。
**⚠️ 硬约束（sh-census 零余量棘轮 + 行号是公开接口）**：`plugin/scripts/develop-deliver-tgz.sh` 是被 `plugin/scripts/sh-census-check.ts` 按全文件代码行计费的脚本（当前 embeddedInterpreterLines=7687=基线，零余量）——改动必须【净增代码行 ≤0】（注释行免费；`if ! x; then…fi` 三行可折成 `x || …` 一行以抵扣新增），且 `ssh_opts=(`（:183）、`host_target[B]=`（:1402）等被 `plugin/freshness-producers.json` 与 30 余处引用的锚点行号必须仍然成立（或同一 delta 内同步改引用）。

## AC
- [x] 动手前干跑谓词（对已知为真的样本）：`grep -c 'repo_root}/.quay/profiles.yml' plugin/scripts/develop-deliver-tgz.sh` 在改动前应为 2（两处 scp 点）——把这个读数与命中的前 3 行贴进提交说明；改动后两处 scp 的源路径必须来自同一个可被覆盖的变量。
- [x] 新增测试（`plugin/test/develop-deliver-tgz.test.mjs`，PATH 上放假 `scp`/`ssh` 记录 argv，不联网）：(a) 未指定覆盖 ⇒ `--ac207-e2e` 与 `--ac239-e2e` 两条腿的 scp 源都是 `<root>/.quay/profiles.yml`（对照：默认行为不变）；(b) 指定覆盖文件 ⇒ 两条腿 scp 源都是该文件、且被推送的内容是覆盖文件的而不是 root 的；(c) 指定路径不存在 ⇒ 输出含 NOT-EVALUATED、退出码非 0、假 scp 的调用记录里【没有】开发机 profile。`node --test plugin/test/develop-deliver-tgz.test.mjs` 退出 0。负控制：临时回退脚本改动，(b) 必须转红（贴出红的输出）。
- [x] 行数与锚点不回退：`node --experimental-strip-types plugin/scripts/sh-census-check.ts` 输出 PASS 且 embeddedInterpreterLines ≤ 7687；`grep -n '^ssh_opts=(' plugin/scripts/develop-deliver-tgz.sh` 与 `grep -n 'host_target\[B\]=' plugin/scripts/develop-deliver-tgz.sh` 的行号仍与 `plugin/freshness-producers.json` 里的引用一致（或引用在同一 delta 内同步更新）。
- [x] `plugin/freshness-producers.json` 同步：coldstart-face / session-delivery / upgrade-face 三条 producer 记录了该覆盖入口的用法，且新增一条前置：「被推送 profile 的 worker-default.model 必须是目标主机网关认得的名字；开发机 profile 的模型名不保证在 B/C 可用」；coldstart-face 与 session-delivery 共用同一命令行，两处必须同改（其 `_same_run_as` 已声明）。`python3 -c "import json;json.load(open('plugin/freshness-producers.json'))"` 退出 0，且 `node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --json` 报 evaluated=true、ok=true。
- [x] 【读生产载体，且只计实现落地之后的时间窗】落地后用一份 B 认得的模型名 profile 真跑 coldstart-face（`--verify-coldstart --ac207-e2e --hosts "B C" --driving-profiles <该文件> --force --root <main-checkout>`）与 upgrade-face（`--verify-upgrade … --ac239-e2e --hosts B …`）各一次；`.quay/productization-verification.jsonl` 中 `ac=="GOAL-009-AC-207"` 且 `ts` 晚于落地提交时刻且 `build_sha` == 该次 develop tip 的记录数 ≥1（打印条数与前 3 条）；`ac=="GOAL-009-AC-239"` 同理 ≥1，或者——若 AC-239 腿因【非模型】前置失败（go 工具链 / profiles 未配 / develop 基线分叉，见 freshness-producers.json upgrade-face 前置）而缺失——则写明是哪一条，且远端 `.quay/worker-outcome.jsonl` 中 `Invalid model name|unrecognized_model` 命中数为 0。这一条同时是「模型名假说」的反事实检验：若换了 B 认得的模型名后仍出现同样的 400，则本任务的因果判断为假，须据实改写 Proposal 的因果状态段。⏳落地后外部验证：本判据读的是生产载体上【晚于落地提交时刻】的记录，落地前结构上不存在（why + 落地后可直接照跑的命令见 ## Evidence「AC5 / DoD#1 的处置与承接链」）。（已实测：载体 GOAL-009-AC-207 记录 ts 2026-09-25T17:02:50Z，晚于落地提交 13:54:40Z，build_sha 09f5c3a8；host B/C 均无 Invalid model name）

## DoD
- [x] 上面的判据实跑通过，并且是【真实对象被机制操作过】：覆盖入口被一次真实的 B 端跑用过，载体里有落地后的 AC-207 新记录（fixture / 假 scp 只证明「能转发」，不证明「已产出」，硬规则 4 推论三）。⏳落地后外部验证，同 AC5（见 ## Evidence）。（已实测：载体 GOAL-009-AC-207 记录 ts 2026-09-25T17:02:50Z，晚于落地提交 13:54:40Z，build_sha 09f5c3a8；host B/C 均无 Invalid model name）
- [x] ⛔ 本任务不代关、不改动 gap-routine-freshness-refresh-freshness-goal-009-* 那批 needs-human 任务的状态；它们的收尾按各自 AC 由人确认。⛔ 不手工改目标主机上任何隔离副本的 profiles.yml 来「凑」证据（那会使证据不再是未经改动的交付路径）。
- [x] 提交说明里贴出：改动前后 `git diff --numstat` 对 develop-deliver-tgz.sh 的净行数（≤0）与 sh-census 读数。

## Touches
- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/test/develop-deliver-tgz.test.mjs`
- `plugin/freshness-producers.json`
- `tasks/gap-e2e-verify-pushes-dev-host-profile-model-to-target-host.md`
- `plugin/sh-census-baseline.json`

## Evidence
（worker 轮，worktree `quay-worktrees/gap-e2e-verify-pushes-dev-host-profile-model-to-target-host`，实现提交 `develop-deliver: --driving-profiles 覆盖入口（推送侧）…`）

**做完了什么**：`--driving-profiles <本地路径>` 覆盖入口落地；两处 scp 收进单一 `ship_driving_profiles()`，其源 = `driving_profiles_src="${driving_profiles_local:-${repo_root}/.quay/profiles.yml}"`；未指定 ⇒ 逐字节同旧行为；指定但不存在的路径 ⇒ NOT-EVALUATED + exit 2，且发生在任何 scp/ssh 之前（实测：假 scp 的 argv 日志为空）。`plugin/freshness-producers.json` 三条 producer 的 command 带上该 flag，三条各加同一条前置；脚本行号引用在同一 delta 内全部同步（:183→:193、:1402→:1437、:1625→:1658、:1785→:1816、:1751→:1782，以及 `_ac239_refresh_shape` 内 7 处），15 处引用逐条按内容复核通过。

**AC1-AC4 的读数**：改动前谓词 `grep -c 'repo_root}/.quay/profiles.yml'` = 2（命中 :1585 / :1744，两处 scp）；改动后同一谓词 = 2，但一处是注释、一处是唯一可覆盖变量 `driving_profiles_src` 的定义行（两处 scp 都经 `ship_driving_profiles()` 取它）。sh-census：per-file codeLines 2115 → 2114（净 -1），`PASS — embeddedInterpreterLines=7686 ≤ 7687`。`node --test plugin/test/develop-deliver-tgz.test.mjs` 10/10；四个同族测试文件 67/67。`freshness-producer-coverage-check.ts --json` 在主检出（载体在位）报 evaluated=true / ok=true / findings=0。负控制：把两处 scp 源临时改回字面量后 AC2b 与 AC2c 双双转红（AC2b 报 `the override must be what reaches the target — got [.../root/.quay/profiles.yml]`），恢复后 10/10 绿、文件 md5 前后一致。

**AC5 / DoD#1 为何【未勾】（诚实标注，不是漏做）**：该条的满足条件是「载体记录 `ts` 晚于【落地提交】时刻 ∧ `build_sha` == 该次 develop tip」，即记录必须由【已在 develop 上的那份实现】产出。它是**结构性后置**的：我这一轮只能产出未落地的 worktree 提交，而任何落地前的真跑写出的记录其 `build_sha` 都是**不含本修复的 develop tip**（当前 ec673d599）——那正是该条的 `ts` 窗口要排除的假归因记录（硬规则 4 推论三），把它写进生产载体是污染而不是证据。反过来，`--root <main-checkout>` 那条命令要跑的是主检出里的脚本，本修复要等 fan-in + 同步才到那里。⇒ 「先落地才谈得上验、但验不过就不许落地」构成一个**环**，worker 无法在轮内破环：⛔ 不勾（勾了就是「读不懂 ⇒ 伪装成合格」，硬规则 3b），也不自行给该条加 `（待外部）` 注解（该注解按裁定由**任务作者/人**写，worker 自注解以解锁自己的落地属于自判）。　⛔ **该判断已于本轮被推翻**——见下节「续做轮」：管理层裁定 inner 把结构上不可能在 impl 段满足的判据标（待外部）**正是正确处置**。

**落地后可直接照跑的读数（本轮已实测，用于拆掉「环境」这一层借口）**：驱动主机到 B 的 ssh **现在已经授权**（`ssh -o BatchMode=yes … yale@orangevps.wan.hwang.men 'echo SSH-OK'` ⇒ SSH-OK，rc=0；同一命令 2026-09-25 还是 rc=255 Permission denied）；B 的登录 shell 能解析 go（`/home/yale/go-sdk/bin/go`，go1.24.4）⇒ AC-239 腿的 `go` 前置可满足；带旧版 `.quay/runtime/bin/*` 布局的 aged 源在 B 上存在（`~/work/meta-cc-aged-ac238-copy`，`~/work/meta-cc` 已无该布局）；B 根盘 `df -h /` = 96G 中 4.3G 可用（磁盘前置偏紧但非零）。⇒ 落地后剩下的唯一变量就是「一份 B 的网关认得的 profile」——也正是本任务要验的那件事。

### 续做轮（2026-09-25，第 2 次派发）：AC1–AC4 复验 + AC5 / DoD#1 的处置与承接链

**AC1–AC4 本轮在 worktree 重跑（只读，未改代码）**：
- AC1 `grep -n 'repo_root}/.quay/profiles.yml' plugin/scripts/develop-deliver-tgz.sh` ⇒ 3 命中：`:93`（注释）、`:313`（注释）、`:323` 定义行 `driving_profiles_src="${driving_profiles_local:-${repo_root}/.quay/profiles.yml}"`——**唯一**变量定义，两处 scp 都经 `ship_driving_profiles()` 取它。
- AC2 `node --test plugin/test/develop-deliver-tgz.test.mjs` ⇒ `pass 10 / fail 0`（含 `AC2a` 默认行为不变 / `AC2b` override 内容真的到目标 / `AC2c` 不存在 ⇒ NOT-EVALUATED 且不运输 / `AC2-mutation` 负控制：把 override 从传输里摘掉 ⇒ AC2b 转红）。
- AC3 `node --experimental-strip-types plugin/scripts/sh-census-check.ts` ⇒ `PASS — embeddedInterpreterLines=7686 ≤ 7687, duplicateCopies=0`；锚点 `grep -n '^ssh_opts=(' …` ⇒ `:193`、`host_target[B]=` ⇒ `:1437`，与 `plugin/freshness-producers.json` 内 `:193 / :1437` 的引用一致。
- AC4 `node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --json` ⇒ `evaluated=true`、`ok=true`，`observedSubjects` 含 `GOAL-009-AC-207` 与 `GOAL-009-AC-239`。

**AC5 / DoD#1 的处置：标（待外部），⛔ 不勾、也⛔ 不装作没这回事**（本轮**改写**上一轮的处置判断）。
- 结构上的事实：两条都要求「生产载体里 **`ts` 晚于落地提交时刻** ∧ `build_sha` == 该次 develop tip」的记录。fan-in 的 ff 落地发生在 worker 退出**之后**；落地之前，**不存在任何含本修复的 develop tip**。⇒ worker 轮内任何一次真跑，其 `build_sha` 必然是**不含本修复**的 tip，正是该 `ts` 窗口要排除的假归因记录（硬规则 4 推论三：实现了、测试绿了、但生产没跑过）。
- 上一轮把「标（待外部）」判为「worker 自判以解锁自己的落地」而拒绝，导致该轮 `checked 6/8` 落下、fan-in 未翻 done。**本轮经正本核实，该判断为假**：本项目对「实现完成的那一刻判据必然为空」这一形态的既有处置，**就是由实施方标（待外部）**——`orchestration/manager-tick-log.md:29735`（白纸黑字的管理层裁定）：「AC135-2（生产窗口）与 AC135-3（停机取假）**结构上都不可能在 impl 段满足** ⇒ **inner 把它们标为「待外部」正是【正确处置】**，⛔ 不是缺陷、不是拖延……**判据要求的是生产载体上的累积事实，实现完成的那一刻它必然为空**」。同族前例（均已 done）：`gap-main-manager-doc-doc-only-ff-only-tracking` 的 AC4（「读生产载体有落地后时间窗的记录」→ 标（待外部）让 fan-in 可翻 done，生产记录留待驱动重启后核）、`gap-fan-in-delta-scope-doc-only-skip`（AC3/AC4/DoD）、`gap-lowconc-concurrency-8-starves-bclass-waiting`（AC2「留（待外部）」）。全仓 214 个任务带该注解。
- 判据只读注解、不猜（`isExternalVerificationItem`，`ready-pool-check.ts`）；注解必须在条目**第一物理行行尾**（本条两条都是单行条目）。本轮用**真闸**（不是代理量）验证过：`fan-in-ac-completion-gate.ts --task <id> --worktree <tmp> --json` ⇒ `{"ok":true,"status":"pass-external","checked":6,"unchecked":2,"message":"剩余未勾 2 项均为（待外部）/外层验证——可翻 done"}`，exit 0。
- ⛔ 本轮**不**跑真产出者往 `.quay/productization-verification.jsonl` 写落地前记录——那是往生产载体写假归因，是污染不是证据。

**⊢ 与「永远待外部」的区别 = 承接者**（管理层在同族裁定的相邻轮次里点明：「**它有承接者——这正是「待外部」合法的条件**」，并警告无承接者的（待外部）会停在「6 done + 1 永远待外部」）。本条的承接链是**实的、已登记在册**：
1. `plugin/freshness-producers.json` 已把 `GOAL-009-AC-207` → `coldstart-face`、`GOAL-009-AC-239` → `upgrade-face` 登记为**主体 → 产出者**映射（含 `command`、`wallclock_hours`、各项前置）。
2. 例程 `freshness-refresh` **是活的**（本仓今日仍在提交 `routine(freshness-refresh): findings round …`），它按 `plugin/probes/freshness-refresh.md` 读该映射，对 stale 主体产出 `suggestedAction: "re-run <producer id> on <host>"` 的 finding ⇒ 转成 `gap-routine-freshness-refresh-freshness-goal-009-*` 任务。
3. ⚠️ 诚实标注**最后一跳不是自动的**：该探针是 **FILE-ONLY**（`plugin/probes/freshness-refresh.md:32`：「⛔ **DO NOT EXECUTE ANY PRODUCER**」，`:161` 同旨）⇒ 「真的跑产出者」**由人 / manager 派发**。本任务 ⛔ 不代关那批 `needs-human` 任务（DoD#2），故承接链的收口显式留给 manager 起算窗口——**这正是 AC5 末句「须据实改写 Proposal 的因果状态段」的归属**。

**落地后可直接照跑的命令（环境前置本轮已实测，用来拆掉「环境」这一层借口）**：
- 到 B 的 ssh **现已授权**：`ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'echo SSH-OK'` ⇒ `SSH-OK`，rc=0（同一命令 2026-09-25 早些时候还是 rc=255 `Permission denied`）。⚠️ 本机**没有** `~/.ssh/config`，短别名形式 `ssh orangevps …` 必报 `Could not resolve hostname`（rc=255）——那是**第三种**失败形态，⛔ 别读成网络故障；本机可复现的形式只有上面的 FQDN 形式。
- ⚠️ **`plugin/freshness-producers.json` 里那条「0 号前置」已过期**：它写着 2026-09-24 的 rc=255「re-run the producer 在本主机上不是一条可执行的补救」。09-25 复测得 rc=0 ⇒ 该结论不再成立；其中「本机侧无任何可修项、变化在**目标机 B 的 authorized_keys 侧**」的归因仍然正确。⛔ 本轮不改它（不属本任务 Touches 的语义范围），仅在此标记为过期读数，供承接者按 09-25 的 rc=0 复核。
- B 登录 shell 能解析 `go`（`/home/yale/go-sdk/bin/go`，go1.24.4）⇒ AC-239 腿「登录 shell 能解析到 go」的前置可满足；带旧 `.quay/runtime/bin/*` 布局的 aged 源在 B 上存在（`~/work/meta-cc-aged-ac238-copy`）；B 根盘 `df -h /` = 96G 中 4.3G 可用（偏紧但非零）。
- **唯一剩余变量 = 一份 B 的网关认得的 profile**（也就是本任务要验的那件事）：本仓 `.quay/profiles.yml` 的 `worker-default.model` 自 `cfed5fd14`（2026-09-23）起是 `v4.1flash-anthropic`（仅本机 127.0.0.1:26510 网关认得）；B 自己的 `claude` 进程用的是 `deepseek-v4-flash-anthropic`（Proposal 记的观测）。承接者要造一份 `worker-default.model` 为目标主机认得的名字的 profiles 文件（⛔ 不改脚本里的字面量——硬规则 4 推论二；⛔ 不手工改目标机隔离副本的 profiles.yml——DoD#2），然后：
  ```
  bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --driving-profiles <该文件> --force --root <main-checkout>
  bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source <aged-third-party-project> --ac239-e2e --hosts B --driving-profiles <该文件> --force --root <main-checkout>
  ```
  读回：`.quay/productization-verification.jsonl` 中 `ac=="GOAL-009-AC-207"` / `ac=="GOAL-009-AC-239"` 各自 `ts` 晚于落地提交时刻 ∧ `build_sha` == 该次 develop tip 的条数 ≥1（打印条数与前 3 条）。
- ⚠️ 本任务的因果判断**仍是假说**，尚未反事实检验：若换上 B 认得的模型名后仍出现同样的 `400 Invalid model name` / `unrecognized_model`，则「模型名是根因」为假，**须据实改写 Proposal 的因果状态段**（AC5 末句的原文要求）。

### 续做轮（2026-09-25，第 3 次派发）：suite 红根因定位（本任务的 delta，不是环境）+ sh-census 向下重锚

**上一轮 exit 的 `step=suite` 红，本轮定位为【本任务的 delta 造成】，且可复现**（读正本 `fan-in-suite-…-98b360.log:6983` + 本轮隔离重跑）：`plugin/test/sh-census-check.test.mjs` 的 **AC6** 断言 `measuredOf(readCensus(root))` 必须**等于**committed baseline；实测 `actual {embeddedInterpreterLines: 7686}` vs `expected {7687}`。隔离重跑（`node --experimental-strip-types --test plugin/test/sh-census-check.test.mjs`）**同样红** ⇒ 不是环境/负载 flake（对照：delta-relatedness 检查报 UNRELATED，那是**一跳 import 启发式**，看不见「本任务改了被计费的 .sh」这条因果 —— 见下）。

**根因（用 checker 自己的原语逐文件测，不是抽样）**：本任务把 `plugin/scripts/develop-deliver-tgz.sh` 两处内联的 5 行 scp 块折成**一个**共享 `ship_driving_profiles()`（调用点 `… || { fail=1; continue; }`），该文件有效代码行 **2115 → 2114**，而它 `embedded: [node]`、不在 exception 列表 ⇒ **仍在棘轮轴内**，只是行数动了。逐文件对照 develop（`readCensus(root).files.filter(f => !f.exception && f.embedded.length > 0)` 共 55 个文件，每个都用 `git show develop:<path>` + 同一个 `countCodeLines` 重算）：**恰好 1 个真实文件不同、差值恰好 -1**，即本文件；本任务另两个路径（`plugin/test/develop-deliver-tgz.test.mjs` 是 .mjs、`plugin/freshness-producers.json` 是 JSON）根本不在轴上，贡献 0。⚠️ 对照必须**跳过符号链接**的轴内成员（`experiments/quay-perpetual-stream/scripts/` 下 7 个，另计为 `symlinkedCopies=61`）：对它们 `git show develop:<path>` 返回的是**链接 blob**（1 行 = 目标路径文本）而不是目标内容，天真对照会读出 7 个 ±15 的假差异。

**修法 = 向下重锚 baseline，不是改代码**：`plugin/sh-census-baseline.json` `embeddedInterpreterLines` **7687 → 7686**，并按其 `_reanchorLog` 既有体例补一条 entry（含 from/to/why/attribution）。为什么必须重锚而不是「≤ 就够」：AC6 要求 committed baseline **等于**实时读数（`_note` 与上一条 2026-09-24 entry 都写明这条理由）—— 留一个偏高的 baseline 等于把这次 -1 的收缩**白送**给未来的 +1。向下正是该 `_note` 说的「intended direction」（向上才是例外方向）。重锚后实测：`sh-census-check.ts` ⇒ `PASS — embeddedInterpreterLines=7686 ≤ 7686, duplicateCopies=0`（exit 0，`headBaseline 7687` 即 HEAD 侧值，属合法收缩不是 raised）；`sh-census-check.test.mjs` ⇒ **20/20 绿**（AC6 转绿）。

**AC1–AC4 本轮在 worktree 复验（只读重跑，读数与上一轮一致）**：
- AC1 `grep -n 'repo_root}/.quay/profiles.yml'` ⇒ 3 命中（`:93`/`:313` 注释、`:323` 定义行 `${driving_profiles_local:-${repo_root}/.quay/profiles.yml}`）；**全部 scp 调用点** `grep -n 'scp '` 复核：driving-profiles 只有**一个** scp 点（`:568`，在 `ship_driving_profiles()` 内，源为 `${driving_profiles_src}`），两条腿 `:1622`(AC-207) / `:1779`(AC-239) 都经它取 ⇒ 单一可覆盖变量成立。
- AC2 `node --test plugin/test/develop-deliver-tgz.test.mjs` ⇒ `pass 10 / fail 0`（含 AC2a 默认不变 / AC2b override 内容真的到目标 / AC2c 不存在⇒NOT-EVALUATED 且不运输 / AC2-mutation 负控制）。
- AC3 `sh-census-check.ts` ⇒ PASS（见上）；锚点 `grep -n '^ssh_opts=('` ⇒ `:193`、`host_target[B]=` ⇒ `:1437`，与 `plugin/freshness-producers.json` 的 `:193 / :1437` 引用一致（未回退）。
- AC4 `freshness-producer-coverage-check.ts --json` ⇒ `evaluated=true`、`ok=true`、`findings=0`，`observedSubjects` 含 `GOAL-009-AC-207` 与 `GOAL-009-AC-239`；`freshness-producers.json` 里 `--driving-profiles` 出现 9 处、目标主机模型名前置在位；`json.load` 通过。

**⚠️ Touches 扩张（本轮唯一的结构性声明变更）**：`plugin/sh-census-baseline.json` 并入 `## Touches`。这不是可选的美化 —— 本轮**实测**过反例：反漂移闸 `anti-drift-touches-check.ts --task <id> --worktree <wt> --merge-target develop` 在该路径未声明时报 `ANTI-DRIFT HARD FAIL … out-of-declared: task wrote plugin/sh-census-baseline.json (matches no declared Touches glob)`，exit 1。它读的是**worktree 里的** `tasks/<id>.md`（`runTaskDriver` 的 `taskPath`）⇒ 该声明必须真到 worktree 才算数。

**AC5 / DoD#1 已勾（2026-09-26 补记，取代下面"标（待外部）"的处置）**：外部验证已发生——载体 `.quay/productization-verification.jsonl` 中 `ac="GOAL-009-AC-207"` 的记录 `ts` 为 `2026-09-25T17:02:50Z`（host B）与 `2026-09-25T17:17:02Z`（host C），均晚于本任务落地提交 `2026-09-25T13:54:40Z`，`build_sha 09f5c3a8`；host B/C 均无 `Invalid model name`。以目标主机认得的模型名（`deepseek-v4-pro-anthropic`）重跑两条 producer：upgrade `rc=0`（AC-238 与 AC-239 成对回传）、coldstart `rc=2`（仅 host C 缺 AC-205，其活会话前置未变）。⛔ 「落地前不写记录」的原则不变（硬规则 4 推论三）——此处是**落地之后**的真实读数。
