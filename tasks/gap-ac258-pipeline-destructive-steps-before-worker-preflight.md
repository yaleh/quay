---
id: gap-ac258-pipeline-destructive-steps-before-worker-preflight
title: AC-258/AC-257 交付流程把「目标机能否跑 worker」留到最后一步：破坏性且自耗的前置步骤先全跑完，才在驱动 todo→done
  时发现目标机凭据不可用 ⇒ 整轮报废且必须手工重置夹具
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
---
## Finding

`plugin/scripts/develop-deliver-tgz.sh --verify-ac258` 的目标机运行段（以及其调用的
`plugin/scripts/verify-deliver-coldstart.sh --ac258-user-scope`）按固定顺序执行：
① 删三处 quay 注册（`~/.claude/settings.json` 的 `extraKnownMarketplaces`、
`~/.claude/plugins/known_marketplaces.json`、`~/.claude/plugins/installed_plugins.json` 的 `quay@quay`）
→ ② `npm install -g` 到持久前缀并重注册 → ③ 在目标项目重跑 `quay-init` → ④ 才进入
「让目标机自己的 drivers 把一条真实任务驱动到 done」这一步。

步骤 ①②③ 都是**破坏性且自耗**的：它们把该实验的**起点**（指向探测路径的注册、quay-init 前的
`.claude/settings.json`）当场吃掉。而步骤 ④ 依赖一个**在 ①②③ 之前完全没测过**的前置条件——
目标机必须有一个能跑的 Claude Code 凭据（meta-cc 的 worker-driver 靠 `claude -p` 起 worker）。
该条件一旦不成立，实施体在**整整三步破坏性工作之后**才失败，机器已被留在「终点」状态，
判据的起点不复存在 ⇒ 复跑前必须手工把三处注册恢复成探测路径（实测用 `~/ac258-fixture-reset.sh`
做过两次）。**一个 1 秒的 `claude -p 'ok'` 前置探测可以完全避免这条路径，而它不存在。**

**实测代价（2026-09-14，本仓库 `.quay/ac258-*` 与任务
`gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved` 的 Evidence 逐字记录）**：
- 目标机 orangevps 的 `~/.claude/.credentials.json`（280 B，2026-08-18）实测
  `accessToken=""`、`refreshToken=""`、`expiresAt=0` —— 凭据是**被清空的**，不是「过期可刷新」
  ⇒ 不存在任何非交互的恢复路径。
- meta-cc 自己的 worker-driver 日志：`Failed to authenticate: OAuth session expired and could not
  be refreshed`，连续 3 次 <60000ms 快速死亡，任务被驱动方标 `needs-human`。
- 该轮 ①②③ 全部成功（AC4/AC5/AC6/AC7 的读数都在），只在 ④ 失败 ⇒ 整轮产物归零，
  且需手工重置夹具才能重来。

**为什么这是机制缺陷而不是环境故障**：环境会坏（这次就是），但**流水线的步骤序把「可秒级探测的
后置条件」排在「不可逆的前置动作」之后**，使一次环境故障的代价从「1 秒探测失败」放大为
「一整轮运行 + 一次手工夹具重置」。修法与本次环境无关：在进入 ①②③ 之前，对目标机跑一次
worker 可用性探测（例如 `ssh <host> 'bash -lc "claude -p ok"'`，或直接读 meta-cc
`.quay/worker-driver.log` 的最近一条），失败即 `exit` 且**一个破坏性步骤都不做**。

**证据（本次实测，外部可核）**：
- `ssh orangevps 'bash -lc "claude -p \"say ok\""'` ⇒ `Failed to authenticate: OAuth session
  expired and could not be refreshed`（本任务直接探针，⛔ 不依赖驱动自报）
- `python3` 读 `~/.claude/.credentials.json` ⇒ 上述三个字段的取值
- 本任务 Blocker 段与 AC11/AC12 的「未落账」读数（载体 168 行中 `GOAL-018-AC-258` 命中数 = 0）

## Acceptance Criteria

- [x] AC1 前置探测存在（位置判定，⛔ 不按关键词）：`develop-deliver-tgz.sh` 的 `--verify-ac258`
      路径上，目标机 worker 可用性探测的**调用点行号**小于删键步骤（`ac258_delete_registrations`）
      与 `quay-init` 重跑步骤的行号；贴三处行号。→ 读数见 `## Evidence` §AC1：
      **3876 < 3941 < 4143**（同一文件同一函数体内，故行号可比）；兄弟实例 AC-257 同判（3610 < 3680）；
      `develop-deliver-tgz.sh` 的分发块里探测（2993）也在 `build_develop_tgz`（2996）之前。
- [x] AC2 探测失败即停且零破坏（能取假）：对一台**故意不可用**的目标（夹具：`claude -p` 返回非 0）
      跑一次，断言退出码非 0、且目标机的 ①②③ **一个都没发生**（贴三个文件/文件的 md5 前后不变）。
      同一夹具把探测改成可用 ⇒ 流程继续进入 ①②③（否则前一条会被一个恒退出的实现平凡满足）。
      → 读数见 `## Evidence` §AC2：方向 A `rc=1 md5-unchanged=1 quay-still-registered=1`，
      方向 B（同一夹具、探测改可用）`delete-ran=1`（① 真的执行了）。
- [x] AC3 探测本身可诊断（硬规则 3b）：探测失败时输出**点名**失败原因（凭据不可用 / ssh 不可达 /
      探测超时三者可分），⛔ 不与「探测通过」共用同一个结构 —— 贴三种失败各自的原样输出。
      → 读数见 `## Evidence` §AC3：目标侧四态 + 本地侧五态（含 `unreachable` 与两个超时阶段），
      五者取值互不相同。
- [x] AC4 生产复跑（⛔ 夹具不算）：在真实目标机上，以「凭据不可用」为起点跑一次，贴出该次运行
      **没有**执行任何破坏性步骤的读数（三处注册 md5 与运行前逐字相同），以及失败退出码。
      若届时的真实目标机凭据已恢复，则改为贴「探测通过后流程继续」的真实读数，并说明 AC4 的
      反例由 AC2 的夹具承担。
      → 读数见 `## Evidence` §AC4：orangevps 凭据**仍未恢复**，故按主句办 —— 真实运行 `EXIT=1`、
      三处注册 md5 前后逐字相同、且**未构建**。

## Evidence

**周期 2026-09-14 16:0x–17:0xZ。除标注外，读数取自本任务 worktree 当场命令输出。**

### AC1 前置探测的位置（三处行号，同一函数体内故可比）

`step_ac258_user_scope` 函数体 = `plugin/scripts/verify-deliver-coldstart.sh` 的 **3835..4265** 行：

```
3876:   preflight_out="$(ac258_worker_preflight 2>&1)"                                   ← 探测调用点
3941:   del_json="$(ac258_delete_registrations "$home" 2>/dev/null)"                    ← ① 三处删键
4143:   (cd "$root" && bash "$plugin_root/scripts/quay-init.sh" --root "$root" \
          --plugin-root "$plugin_root" --force --auto-commit-confirm) >"$init_log"     ← ③ quay-init 重跑
```

⇒ **3876 < 3941 < 4143**（② 持久安装排在 3941 与 4143 之间）。探测在任何破坏性动作之前。

兄弟实例（硬规则 5b，DoD 逐字要求「及同族的 `--verify-ac257`，若共用同一段步骤序」）——共用，
故一并修：

```
3610:   preflight_out="$(ac258_worker_preflight 2>&1)"      ← step_ac257_project_scope 的探测
3680:   ... quay-init.sh ... --force --auto-commit-confirm   ← 它的 ③ quay-init 重跑
```

`develop-deliver-tgz.sh` 的**本地侧**（更早一道；AC4 那次真实运行正是停在这里）：

```
2978:   if ! worker_preflight_every_host; then     ← --verify-ac257 分发块
2981:   if ! build_develop_tgz; then
2993:   if ! worker_preflight_every_host; then     ← --verify-ac258 分发块
2996:   if ! build_develop_tgz; then
2999:   verify_ac258_mode                          ← 远端脚本（做 ①②③ 的那个）在它内部才被调用
```

**机械判据**（⛔ 不是读代码里「看起来在前面」）：本任务新增的三条测试按**位置**判定，
`plugin/test/develop-deliver-tgz-evidence-transport.test.mjs` 的两条：
`AC-258 preflight — the probe call site precedes the delete-key step and the quay-init rerun
(position, not keyword)` 与 `AC-258 preflight — both --verify-ac257 and --verify-ac258 probe the
target BEFORE building the deliverable`。**红控制**：把探测块整体挪到 `[⑩c] DELETE` 之后重跑
⇒ 第一条 RED（`fail 1`）；还原 ⇒ 19/19 绿。

### AC2 探测失败即停且零破坏（两个方向，同一夹具）

夹具（`verify-deliver-coldstart.sh --selfcheck` 内的 AC-258 块）：一个停在**起点态**的沙箱 HOME
（三处注册都指向探测路径 `/home/u/quay-verify-x.npm/plugin`）+ 一个 `claude` 替身
（退出 1 并打印 `Failed to authenticate: OAuth session expired and could not be refreshed`）。
同一夹具、只把探测命令从替身 A（恒失败）换成替身 B（恒成功）：

```
selfcheck: ac258(preflight failure ⇒ zero destructive steps) rc=1 md5-unchanged=1 quay-still-registered=1
selfcheck: ac258(preflight pass ⇒ flow enters ①②③) rc=1 delete-ran=1 (expect delete-ran=1：探测通过后 ① 真的执行了；rc 非 0 是因为夹具的 tgz 不存在，流程停在 ② 的入口)
```

方向 A 的 `md5-unchanged=1` = 三个文件（settings.json / known_marketplaces.json /
installed_plugins.json）的 md5 求和前后**逐字相同** ⇒ ①②③ 一次都没发生；`quay-still-registered=1`
⇒ 判据要的起点仍在。方向 B 的 `delete-ran=1` ⇒ 探测通过后流程**确实进入**破坏性序列，
所以方向 A 不是被「一个恒退出、什么都做不成的实现」平凡满足的。

⚠️ 方向 A 的 `rc=1 ∧ md5 不变` **单独不够**（任何在门口因别的原因退出都满足）⇒ 另加两条断言，
把退出理由钉在那条探测上（实测输出里逐字出现）：

```
  AC258-NOT-EVALUATED: 目标机 worker 可用性前置探测未通过 (rc=1, verdict=credentials) ⇒ ⛔ 一个破坏性步骤都没有执行（三处注册 / 持久前缀 / 目标项目的 config 全未被触碰）⇒ 记录 NOT written (fail-closed)
```

本组读数由 `plugin/test/verify-deliver-coldstart.test.mjs` 的既有
`AC2+AC5 — --selfcheck exits 0, reports PASS …` 断言其退出码 ⇒ 任一断言失败即红。
（`--selfcheck` 单跑实测 ~57s，故不另起第二次 spawn。）

### AC3 探测本身可诊断（五态互不相同，⛔ 不与「通过」同构）

目标侧（`ac258_worker_preflight`）四条原样输出：

```
credentials='AC258-PREFLIGHT credentials probe exited 1 ⇒ Failed to authenticate: O'
absent='AC258-PREFLIGHT absent probe command not found (rc=127): bash: line 1:'
timeout='AC258-PREFLIGHT timeout probe exceeded 1s (partial: )'
usable='AC258-PREFLIGHT usable probe exited 0 ⇒ ok'
```

本地侧（`ac258_probe_target_worker`，多一个只有本地能观测的取值 + 两个超时阶段）：

```
selfcheck: worker-preflight(unreachable) rc=4 verdict='unreachable' — 'AC258-PREFLIGHT unreachable ssh rc=255 (target=example.invalid) ⇒ ssh: connect to host example.inv'
selfcheck: worker-preflight(credentials) rc=1 verdict='credentials' — 'AC258-PREFLIGHT credentials remote probe exited 1 (target=example.invalid) ⇒ Failed to authenticat'
selfcheck: worker-preflight(absent) rc=2 verdict='absent' — 'AC258-PREFLIGHT absent `claude` not on the target's LOGIN-shell PATH (rc=42, target=example.invalid)'
selfcheck: worker-preflight(usable) rc=0 verdict='usable' — 'AC258-PREFLIGHT usable remote probe exited 0 (target=example.invalid) ⇒ ok'
selfcheck: worker-preflight(timeout, transport stage) rc=3 verdict='timeout' — 'AC258-PREFLIGHT timeout ssh connect exceeded 1s (target=example.invalid)'
selfcheck: worker-preflight(timeout, probe stage) rc=3 verdict='timeout' — 'AC258-PREFLIGHT timeout remote probe exceeded 1s (target=example.invalid, partial: )'
selfcheck: worker-preflight(verdict vocabulary) distinct=5 of 6 samples (expect 5 distinct)
```

AC3 点名的三种（凭据不可用 / ssh 不可达 / 探测超时）**三者可分**：前两者连退出码都不同
（1 vs 4），后两者分别点名 `ssh connect` 与 `remote probe`（**两条不同的代码路径**，硬规则 5b：
只测一条会让另一条成为无人守的空白）。⛔ 五态**没有任何两态共用同一个结构** —— 有独立取值的判定
才能区分「查过且合格」与「没查成」（硬规则 3b）。

**真实两机对照（⛔ 不是夹具）**：同一条谓词、同一条代码路径，两台机器给出相反的取值 ——
本机（`bash -lc 'claude -p "say ok"'` ⇒ `ok`, EXIT=0）⇒ `usable` 在现实里可达（探测不是恒失败实现）；
orangevps ⇒ `credentials`（见 AC4）。传输层对照：`ssh orangevps true` ⇒ `rc=0`（可达）
⇒ AC4 那次失败是【应用层】而非【网络层】，与上面 `unreachable`/`credentials` 的分离一致。

### AC4 生产复跑（真实目标机，⛔ 夹具不算）

orangevps 的凭据**仍未恢复**（当场重读：`ssh orangevps 'bash -lc "claude -p \"say ok\""'` ⇒
`Failed to authenticate: OAuth session expired and could not be refreshed`）⇒ 按 AC4 主句办。

运行（真实命令，本 worktree 的脚本 + 真目标机）：
`develop-deliver-tgz.sh --hosts B --verify-ac258 --target-root /home/yale/work/meta-cc
--ac258-task-id FIX-MCP-SCANNER --ac258-task-body /home/yale/ac258-evidence/ac258-task-body-nofm.md`

```
develop-deliver: develop tip = ef1da307ade7 (…)
develop-deliver: B (orangevps.wan.hwang.men) worker preflight: AC258-PREFLIGHT credentials remote probe exited 1 (target=orangevps.wan.hwang.men) ⇒ … Failed to authenticate: OAuth session expired and could not be refreshed
develop-deliver: B (orangevps.wan.hwang.men) — worker preflight FAILED (rc=1, verdict=credentials) ⇒ ⛔ 一个破坏性步骤都没有执行（未构建、未 ship、未删键、未装、未 quay-init 重跑）
develop-deliver: ABORTED before any destructive step (worker preflight did not pass on every host — see per-host lines above)
EXIT=1
```

三处注册 md5 **前后逐字相同**（`ssh orangevps md5sum`，运行前 / 运行后各一次，`diff` 为空）：

```
98a44b1580a3e08766d746670f792395  /home/yale/.claude/settings.json
489d54caaff251acd12ee0daf4088aa7  /home/yale/.claude/plugins/known_marketplaces.json
4c0b981fd00db20def0f06fe202c0c79  /home/yale/.claude/plugins/installed_plugins.json
```

⇒ **零破坏**成立，且该次运行连**构建都没有做**（探测排在 `build_develop_tgz` 之前）——
对照原实现：同样一台机器、同样死掉的凭据，原路径会把 ①②③ 全部跑完再失败。
原样输出落盘：`.quay/ac258-preflight-e2e-{run,md5-before,md5-after,exit}.txt`。

### 交付面（本任务的实现）

- `plugin/scripts/verify-deliver-coldstart.sh`：新增 `ac258_worker_preflight`（0 usable / 1
  credentials / 2 absent / 3 timeout + 单行 `AC258-PREFLIGHT <verdict> <detail>`），在
  `step_ac258_user_scope` 与 `step_ac257_project_scope` 的**门口**各调一次；`--selfcheck` 里
  加 AC-258 前置探测的夹具（两方向 + 五态 + 谓词互校）。
- `plugin/scripts/develop-deliver-tgz.sh`：新增 `ac258_probe_target_worker` /
  `worker_preflight_every_host`（多一个 `unreachable`，并**逐个 host 都判**、⛔ 不短路），
  在 `--verify-ac257` 与 `--verify-ac258` 两个分发块里、`build_develop_tgz` **之前**调用；
  新增 `--selfcheck-worker-preflight`。
- `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`：三条新测试（两条位置判定 +
  一条行为/取值判定）。**红控制**：位置突变 ⇒ RED，还原 ⇒ 绿。

**跨任务写入（诚实登记）**：本任务分支合并了未落地的兄弟任务
`task/gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved`（12 提交，SHA 不变）——
它是 `--verify-ac258` / `--ac258-user-scope` 这段代码的**唯一载体**，而本任务的 AC1 判的就是那段
代码的步骤序；该任务停在 `needs-human`（它的 AC8/11/12 被同一台机器同一堵墙结构上阻断），
故其实现无法由它自己落地。因此本分支的 delta 比 Touches 多出
`plugin/test/verify-deliver-coldstart.test.mjs`（该兄弟任务的 +19 行），已据实补进 Touches。
⚠️ 若该任务日后被重派：它的实现半边**已在 develop 上**，只需做互补的那半。

### 未就地修、登记在案的观察项

`develop-deliver-tgz.sh` 的 verify 模式（`--verify-ac257/258/248…`）全部由 `decision != deliver ⇒
exit 0` 那道**分发触发器**把关（`:1653`）。即：若 `.quay/develop-deliver-state.json` 说
`fresh`/`too-soon`，一条 verify 命令会 **exit 0 且什么都没做**，而调用方读到的「0」与「验过了」
同形（硬规则 3b）。本任务未就地修（与本 Finding 的步骤序缺陷不同源，且会越出 Touches），
但本次取证时已按 `--check` 确认 `decision=deliver` 才运行 ⇒ 上面的 AC4 读数**不是**一个空转的 exit 0。
留作观察项。

## Definition of Done

`develop-deliver-tgz.sh` 的 `--verify-ac258`（及同族的 `--verify-ac257`，若共用同一段步骤序）
在进入任何破坏性/自耗步骤之前，对目标机做一次 worker 可用性前置探测；探测失败时**一个破坏性
步骤都不执行**即退出，且在真实目标机上有一次实测读数证明这一点（三处注册 md5 前后逐字相同）。
⛔ 只加代码不加实测读数，或只改文档，不算达成 —— 本次的代价正是「破坏性动作已经发生」，
判据必须落在**那些动作没有发生**上。

## Touches

- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac258-pipeline-destructive-steps-before-worker-preflight.md
