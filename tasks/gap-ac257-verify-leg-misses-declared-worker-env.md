---
id: gap-ac257-verify-leg-misses-declared-worker-env
title: --verify-ac257 腿不下发声明的 worker 环境，而 AC-257/AC-258 共用同一段 worker 前置 ⇒
  只能用旁路凭据的目标机上 AC-257 结构上不可达
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: v1
goal_ac: AC-257
---
## Finding

`plugin/scripts/develop-deliver-tgz.sh` 的 `--verify-ac258` 在远端脚本序言里下发调用方【声明的 worker 环境】：

```
2683:$(ac258_worker_env_export)
```

而 `--verify-ac257` 的远端序言里【没有】这一行（同一文件 ~2249 起，只有 `$(verify_node_export_for "${hk}")`）。
`ac258_worker_env_export` 的**唯一生产调用点**就是上面那一行（`grep -n ac258_worker_env_export` 的另外三处都在
`selfcheck_worker_preflight` 的夹具里）。

后果不是「少一个便利项」：**两条腿共用同一段步骤序** —— `step_ac257_project_scope` 的第一个动作就是
`ac258_worker_preflight`（`verify-deliver-coldstart.sh`，与 `step_ac258_user_scope` 同源）。该前置在【远端进程环境】里跑
`claude -p "say ok"`，读的是它自己进程的 `QUAY_AC258_WORKER_PROBE_CMD` / `QUAY_AC258_WORKER_ENV`。

⇒ 对一台**自身 Claude Code OAuth 已死、只能靠旁路 Anthropic-compatible endpoint 跑 worker** 的目标机
（ad-arm1 / orangevps 都是这个形态：`~/.claude/.credentials.json` 的 `accessToken` 与 `refreshToken` 均为空串、
`expiresAt=0`；而 `~/.local/etc/fjdac-api-key` + `~/.local/bin/claude-fjdac` 是人 2026-09-09 授权的既定形态）：

- **AC-258 腿**：调用方可以声明该环境 ⇒ 前置通过、worker 拿到同一环境 ⇒ 可达。
- **AC-257 腿**：调用方**结构上没有表达方式**把同一环境送到远端进程 ⇒ 远端前置返回 `credentials`，
  `step_ac257_project_scope` 在**任何破坏性步骤之前** `return 1` ⇒ `AC257-NOT-EVALUATED` ⇒ AC-257 记录永不产出。
  失败形态是「记录没写出来」，与「机制真的坏了」同形（硬规则 3b）。

**当场读数（2026-09-15，ad-arm1，非推断）**：

```
$ ssh ad-arm1 'bash -lc "claude -p \"say ok\""'
Failed to authenticate: OAuth session expired and could not be refreshed
REMOTE_RC=1

$ ssh ad-arm1 'bash -lc "source ~/.local/etc/fjdac-api-key; export ANTHROPIC_BASE_URL=\"https://fjbigmodel.fjdac.cn/\"; export ANTHROPIC_AUTH_TOKEN=\"\$FJDAC_API_KEY\"; export ANTHROPIC_API_KEY=\"\"; export ANTHROPIC_MODEL=deepseek-v4-pro-anthropic; claude --model deepseek-v4-pro-anthropic -p \"say ok\""'
[claude-code:unrecognized_model] {"model":"deepseek-v4-pro-anthropic","query_source":"sdk"}
ok
REMOTE_RC=0
```

同一条谓词、同一台机器，只差【声明的环境】—— 而 AC-257 腿无法把它送进去。

**为什么这是同一件事的两端（硬规则 5b）**：`ac258_worker_env_export` 的头注释逐字写着它存在的理由
——「一台目标机只有两条登录面：① 该机自己的 OAuth；② 调用方声明的 Anthropic-compatible 环境」，
以及「片段在远端 `bash -ls` 下**先于** verify-deliver-coldstart.sh 执行 ⇒ 该脚本的前置探测与它随后启动的
driver/worker 继承【同一个】环境 ⇒ 探测对象 == 实际 spawn 对象」。这条理由对 `step_ac257_project_scope`
**逐字成立**（它做的是同一件事：起目标项目的 driver 驱动一条真任务到 done），只是当时只落在了 AC-258 一处。

## Requested action

1. 在 `verify_ac257_mode` 的远端 heredoc 里、`$(verify_node_export_for "${hk}")` 之后加一行
   `$(ac258_worker_env_export)`，与 `verify_ac258_mode` 逐字对齐。
2. 该函数在 `QUAY_AC258_WORKER_ENV` / `QUAY_AC258_WORKER_PROBE_CMD` 都未设时输出为空 ⇒ 对现有全部调用方
   **逐字零变化**（这条本身要有一条判据：未声明时不产生任何字节）。
3. 扩 `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`：断言 `verify_ac257_mode` 的远端序言
   与 `verify_ac258_mode` 一样携带该下发（按位置取，⛔ 不是全文 grep 关键词）。
4. 反向控制：确认「只声明 `QUAY_AC258_WORKER_ENV` 而远端探测仍用缺省谓词」这一不对称由
   `QUAY_AC258_WORKER_PROBE_CMD` 一同下发来消除（该函数已同时下发两者）；若把后者去掉，
   远端前置应回到 `credentials`。

## Acceptance Criteria

- [x] AC1 `grep -n 'ac258_worker_env_export' plugin/scripts/develop-deliver-tgz.sh` 的**生产**调用点从 1 处变 2 处（两处分别位于 `verify_ac257_mode` 与 `verify_ac258_mode` 的远端 heredoc 内），贴命令与输出。
- [x] AC2 判据：把两处调用点各自移出后，对应模式在「远端探测读不到声明环境」这一方向上的行为【可区分】—— 即存在一条机械检查会红（⛔ 不是只靠人读）。
- [x] AC3 未声明时零变化：`QUAY_AC258_WORKER_ENV='' QUAY_AC258_WORKER_PROBE_CMD=''` 下 `ac258_worker_env_export` 输出 0 字节，且既有 `--selfcheck-worker-preflight` 仍 exit 0。
- [x] AC4 端到端：在 ad-arm1 上跑一次 `--verify-ac257`，远端前置须为 `usable` 而非 `credentials`（前后两次读数都贴）。

## Definition of Done

- [x] `--verify-ac257` 与 `--verify-ac258` 在「目标机 worker 登录面」上行为一致：同一份声明、同一处下发、同一处生效。
- [x] 该一致性有机械判据（AC2），⛔ 不是靠注释里写一句「勿忘两处一起改」。
- [x] AC4 的真实两机读数落在记录里（ad-arm1）。

## Evidence

### AC1 — production call sites 1 → 2

```
$ grep -n 'ac258_worker_env_export' plugin/scripts/develop-deliver-tgz.sh
2251:$(ac258_worker_env_export)      ← verify_ac257_mode 远端 heredoc（本次新增，紧随 verify_node_export_for 之后）
2693:$(ac258_worker_env_export)      ← verify_ac258_mode 远端 heredoc（原有）
（其余 3 处形如 env_out="$(QUAY_AC258_WORKER_ENV='' … ac258_worker_env_export)"，在 selfcheck_worker_preflight
  夹具内 —— ⛔ 不计入生产调用点；判据侧的 per-mode 切片同样够不到它们）
```

⇒ 生产调用点 = **2**，两处各自位于目标模式的远端 heredoc 内。

### AC2 — 机械判据（按位置取，逐模式切片）

新增 test（`plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`）：
`AC-257/AC-258 — BOTH legs' remote preamble carries the caller-declared worker env (position, per-mode slice)`。
判定对象 = **该模式自己的 remote heredoc 顶部连续 `$(…)` 段**（⛔ 不是全文关键词 grep：注释/其它模式/夹具里的命中不算），
断言两处都是 `[$(verify_node_export_for "${hk}"), $(ac258_worker_env_export)]`，且导出行排在该 heredoc 里第一个真实步骤
（`bash "\${HOME}/verify-deliver-coldstart.sh"`）之前。

**双向反证（本次当场跑，逐字）** —— 把两处调用点各自移出后，测试均转红：

```
$ sed -i '2251d' plugin/scripts/develop-deliver-tgz.sh   # 移出 verify_ac257_mode 的调用点
$ node --test plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
exit=1    ℹ pass 19   ℹ fail 1   ✖ AC-257/AC-258 — BOTH legs' remote preamble carries …

$ sed -i '2693d' plugin/scripts/develop-deliver-tgz.sh   # 移出 verify_ac258_mode 的调用点
$ node --test plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
exit=1    ℹ pass 19   ℹ fail 1   ✖ AC-257/AC-258 — BOTH legs' remote preamble carries …
```

另有一条**同进程负控制**（硬规则 4：一个结构上不可能取假的检查不是测量）：测试内对同一谓词喂入「已移出该行」的副本，
断言谓词必须翻假 —— 否则正向断言是空转的，而空转的绿与「验过了」同形（硬规则 3b）。

未改动的两处既有判据仍绿（`$(verify_node_export_for "${hk}")` 的**逐模式计数 == 模式数**、以及
`ship_verify_closure` 的逐模式唯一性），故本次新增没有把它们顶掉。

### AC3 — 未声明时零变化

```
$ （用真实源码里的函数定义求值，⛔ 不是抄一份）
  QUAY_AC258_WORKER_ENV='' QUAY_AC258_WORKER_PROBE_CMD='' ac258_worker_env_export
  ⇒ bytes=0
  QUAY_AC258_WORKER_ENV='export A=1' QUAY_AC258_WORKER_PROBE_CMD='' ac258_worker_env_export
  ⇒ bytes=10 content=<export A=1>          （对照组：声明了就逐字下发，故 0 不是恒零伪影）

$ bash plugin/scripts/develop-deliver-tgz.sh --selfcheck-worker-preflight
  selfcheck: worker-env(unset) bytes=0 (expect 0 — 未声明 ⇒ 不下发，⛔ 不回落不猜)
  selfcheck: worker-env(env-only) verbatim=1 (expect 1)
  selfcheck: worker-env(probe-cmd round-trip) identical=1 (expect 1)
  selfcheck exit=0
```

### AC4 — ad-arm1 端到端（受控对照：唯一变量 = 那一行下发）

命令（两次完全相同，只有「那行在不在」不同）：

```
$ QUAY_AC258_WORKER_ENV='source ~/.local/etc/fjdac-api-key
export ANTHROPIC_BASE_URL="https://fjbigmodel.fjdac.cn/"
export ANTHROPIC_AUTH_TOKEN="$FJDAC_API_KEY"
export ANTHROPIC_API_KEY=""
export ANTHROPIC_MODEL=deepseek-v4-pro-anthropic' \
  QUAY_AC258_WORKER_PROBE_CMD='source ~/.local/etc/fjdac-api-key; export ANTHROPIC_BASE_URL="https://fjbigmodel.fjdac.cn/";
    export ANTHROPIC_AUTH_TOKEN="$FJDAC_API_KEY"; export ANTHROPIC_API_KEY="";
    export ANTHROPIC_MODEL=deepseek-v4-pro-anthropic; claude -p "say ok"' \
  bash plugin/scripts/develop-deliver-tgz.sh --hosts C --verify-ac257 \
    --target-root /home/yale/work/archguard \
    --ac257-plugin-root /home/yale/.local/opt/quay/0.7.0-dev/lib/node_modules/quay/plugin \
    --ac257-task-id TASK-TSCONFIG-EXTENDS --ac257-task-body <local task body>
```

**前（把 `verify_ac257_mode` 里那一行移出）**：

```
develop-deliver: C (ad-arm1.wan.hwang.men) worker preflight: AC258-PREFLIGHT usable remote probe exited 0  ← 本地前置（probe cmd 自带环境）
  [⑨0] worker preflight: AC258-PREFLIGHT credentials probe exited 1 ⇒ Failed to authenticate: OAuth session expired and could not be refreshed
  AC257-NOT-EVALUATED: 目标机 worker 可用性前置探测未通过 (rc=1, verdict=credentials) ⇒ ⛔ 一个破坏性步骤都没有执行
EXIT=1        到达的步骤：仅 [⑨0]
```

**后（那一行在）**：

```
  [⑨0] worker preflight: AC258-PREFLIGHT usable probe exited 0 ⇒ …
  [⑨a] installed quay_version=0.7.0-dev (read from the installed artifact, ⛔ not self-reported)
  [⑨b] settings baseline: reset-to-pre-quay-version(d2ad0a42^) …
  [⑨c] BEFORE hooks.Stop md5=e5255b86660f ; enabledPlugins={}
  [⑨d] quay-init --force rc=0 (rerun=true)
  [⑨e] AFTER hooks.Stop md5=e5255b86660f verbatim-preserved=1 ; enabledPlugins={"quay@quay":true} gained-quay-key=1
  [⑨f] project-scope install: marketplace-add rc=0 install rc=0
  [⑨g] install_scope=project marketplace_path=…/0.7.0-dev/lib/node_modules/quay/plugin
  [⑨h] provider usable: task list returned 450638 bytes
  [⑨i] task already done at entry ⇒ drivers NOT started, no poll
  [⑨j] poll finished: task_status=done (window 3600s)
  [⑨k] task_status=done commit_sha=3b67cf7f5a44 gate_events=3 produced_by_driver=1 evaluated=1
到达的步骤：[⑨a..⑨k] = 11 步（越过原先在 [⑨0] 就 return 1 的那道闸）
```

⇒ **远端前置 `credentials` → `usable`**；本 AC 的对象（远端前置取值）达成。

**⛔ 残留（如实登记，且证明与本改动无关）**：该次运行的**总退出码仍为 1**，但原因换了一道**另一道**闸：

```
AC161-USER-SCOPE: GOAL-018-AC-257 record refused — state=present:quay@quay — user-level
  ~/.claude/settings.json enabledPlugins still carries a quay key; this record's project-scope premise is
  FALSE → nothing written (standing goal AC-161)
```

即：ac-arm1 的**用户级** `enabledPlugins["quay@quay"]` 已存在 ⇒ AC-257 记录的 project-scope 前提为假 ⇒ 记录被拒写。
**「AC-257 记录永不产出」因此在 ad-arm1 上仍成立，但成因已从「登录面送不进去」换成「AC-161 站岗前提被违反」——
后者是本次改动【结构上够不到】的另一件事，也不是本次运行造成的**。判据（硬规则 4 推论四：附一个若假设为假则结果会不同的对照）：

```
$ # 在 ad-arm1 上用一个【沙箱 HOME】重跑该腿自己的 postinstall，看它写不写用户级 enabledPlugins
$ HOME=/tmp/ac4sandbox npm install -g --prefix /tmp/ac4prefix ~/quay-0.7.0-dev.tgz ~/quay-native-0.7.0-dev.tgz
npm-install-rc=0
$ cat /tmp/ac4sandbox/.claude/settings.json
{ "extraKnownMarketplaces": { "quay": { "source": { "source": "directory",
    "path": "/tmp/ac4prefix/lib/node_modules/quay/plugin" } } } }
$ grep -c "quay@quay" /tmp/ac4sandbox/.claude/settings.json
0
```

⇒ 该腿的 `npm install -g`（postinstall = `scripts/register-plugin.mjs`）**只写 marketplace 源，从不写用户级 enabledPlugins**
（与该脚本头注释的 SCOPE POLICY 逐字一致）⇒ ad-arm1 上那个键是**既有污染**（与该模块注释里记的 AC-161 第四次回归同日、2026-09-15），
⛔ 不是本次运行、更不是本次改动引入的。orangevps 现场读数同形（该键存在 ⇒ 该机 AC-257-only 运行同样会被拒）。
**⇒ 这条残留是另一个机制的事，本次不越界处理，只如实上报。**

### 续做（2026-09-15）：先排掉 develop 侧的阻塞红，本 delta 未改

上一轮 fan-in 的 suite 红（`# fail 10` / `STATIC_CHECK_FAILED: checker-mutation-check exit=1`）**与本任务 delta 无关**。
成因在 develop：`ee49cb056`（2026-09-15 16:52:19）把 `delivery-manifest.json` 加进
`scripts/version-consistency-check.ts` 的 `VERSION_ENTRIES`，却**没有**同步更新它的 mutation 夹具
`plugin/scripts/checker-mutation-cases/version-consistency-check.sh`。夹具不建那个文件 ⇒ 新条目落进
`mode:'error'` ⇒ **GREEN 基线自己变红**（夹具内那句 `baseline RED on a consistent store (checker always-red?)`）
⇒ `MUTATION version-consistency-check: always-red` ⇒ 全仓**每一个** fan-in 都死在静态相位。
（同名先例：16:26 那次 suite 日志里该检查仍是 `pass`，因为它那次 fan-in 起于 16:52:19 之前。）

**区分对照**（硬规则 4 推论四：附一个若「与本 delta 无关」为假则结论会不同的对照）——
用 develop 自己的两份文件（`git show develop:<path>`，⛔ 不经本分支）跑同一夹具：

```
（在干净树里放 develop 的 checker + 夹具）
baseline RED on a consistent store (checker always-red?)
CASE_EXIT=4
$ git diff --stat develop -- scripts/version-consistency-check.ts \
    plugin/scripts/checker-mutation-cases/version-consistency-check.sh
（空 ⇒ 两份与 develop 逐字相同；本分支只改过 develop-deliver-tgz.sh 与其测试）
```

**修法**：⛔ 不是把 `delivery-manifest.json` 撤出 `VERSION_ENTRIES`（`ee49cb056` 加它有据：manifest 曾停在 0.5.0
而 checker 读 GREEN，在真实发布路径上致命）；⛔ 也不是改 checker。**补夹具**，并按夹具既有 doctrine 补上它的
注入路径 —— Inject 2/3 的注释逐字说：没有注入路径，「条目加进了 `VERSION_ENTRIES`」与「条目真的在参与判定」
不可区分（硬规则 4）。故 **Inject 4 = 只动 `delivery-manifest.json` ⇒ 必须转红**：

```
$ bash plugin/scripts/checker-mutation-cases/version-consistency-check.sh "$wd"      # 修后
CASE_EXIT=0

$ （负控制：同一份新夹具 vs 9c27bdca0 的旧 checker —— 它不判 manifest）
STAYED-GREEN — delivery-manifest.json-only version drift did not redden the checker (entry not judging)
CASE_EXIT=3        ← 注入路径确实在区分「判了」与「没判」，不是空转（硬规则 3b）

$ bash plugin/scripts/checker-mutation-check.sh --run                                # 全量
MUTATION version-consistency-check: pass
mutations_that_stayed_green: 0 / mutations_that_always_red: 0 / errors: 0
RESULT: PASS — every registered checker went RED under its injected defect and GREEN on restore
```

⇒ 本轮**扩 Touches 一条**并在提交信息里写明理由（⛔ 不是目录级通配）：该文件**不是**本任务的 delta，
而是恢复全仓 fan-in 的救火改动。按既有判据先确认 develop 侧无人正在修
（`git log --all --since=2026-09-15 -- <夹具>` 空；`gap-release-cut-via-workflow-dispatch` 的 worktree 里该文件与
develop 无 diff）⇒ 走「等不到 develop」那条分支，登记为 Touches，而不是让每一轮 fan-in 继续烧在同一个 develop 红上。

### 回归

`bash scripts/test.sh --for-task gap-ac257-verify-leg-misses-declared-worker-env --allow-thin` ⇒ **exit 0**（25 tests pass / 0 fail，
scoped 静态检查全 PASS）。`--verify-ac258` 一侧未改动，其远端序言逐字不变。

## Touches

- plugin/scripts/develop-deliver-tgz.sh
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- plugin/scripts/checker-mutation-cases/version-consistency-check.sh
- tasks/gap-ac257-verify-leg-misses-declared-worker-env.md

Note: this task is filed from the AC-259 re-anchoring worker, where it was discovered (the AC-257 leg had to be driven by invoking the remote verification script directly, with the declared env in the login shell, because this transport leg cannot carry it).
`plugin/scripts/checker-mutation-cases/version-consistency-check.sh` 是 2026-09-15 续做时为排掉 develop 侧阻塞红
（`ee49cb056` 只加条目未补夹具 ⇒ 全仓 fan-in 的静态相位恒红）而扩入的，见 Evidence「续做」一节。