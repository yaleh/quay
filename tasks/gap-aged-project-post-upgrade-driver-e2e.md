---
id: gap-aged-project-post-upgrade-driver-e2e
title: 升级后闭环验证：driver 在已升级的旧痕迹项目（meta-cc 副本）上继续驱动新任务到 done
status: done
labels:
  - gap
parent: null
children: []
extra:
  goal_ac: AC-239
depends_on:
  - gap-aged-third-party-project-quay-upgrade-verification
  - gap-develop-sync-reset-hard-destroys-third-party-project-tree
  - gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing
  - gap-upgrade-entry-never-establishes-branch-model
  - gap-upgrade-verify-transport-missing-binding-checker
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

**2026-09-11 追加：已找到具体化身**（人回忆 + 实测双重确认，人 2026-09-11 裁定用它作为本任务要驱动的
那条新任务内容）：meta-cc 自己有一个真实、已验证、尚未修复的缺陷——`query_session_content` /
`query_session_signals` / `analyze_errors` 等 meta-cc MCP 工具的 `include_subagents=true` 参数，配合
**显式 `session_id` 传参**时**静默失效**（不报错，返回 0 条），只对 `scope=session` / `scope=project`
两种隐式取值生效。

**实证方法**（session-scoped，非全项目模糊搜索）：从本会话某历史子代理 transcript 中取一根只存在于该
`subagents/agent-*.jsonl`、不在其主会话文件中的针（`"Let me first create the worktree"`，文件系统 grep
直接确认两侧计数：主会话文件 0 次、子代理文件 ≥1 次），用当前安装的 meta-cc 跑
`query_session_content(session_id=<该会话>, include_subagents=true, contains=<该针>)` ⇒ **返回 0 条**。
本仓库 `CLAUDE.md` 硬规则1 早在 2026-08-14 就记录过同形状的失败（两根干净针分别查 ⇒ 都返回 0）；
2026-09-11 用当前实际安装的版本重新复现，问题依旧存在。

**版本核实（不只看 changelog）**：本地当前安装 = meta-cc **v3.8.3**（2026-08-02 发布，本会话正在用的
那份）；orangevps 上 meta-cc 项目 = meta-cc **v3.8.4**（2026-08-21 发布）。v3.8.4 的 CHANGELOG 只有
测试/CI 维护项和 AC118 任务流转记录，未提及 subagent / include_subagents。把两边全部 10 个引用了
`"subagents"` 字符串的源文件（`internal/mcp/query/query.go`、`internal/mcp/executor/handlers.go`、
`internal/mcp/executor/consolidated_handlers.go` 等）逐一 `diff` —— **全部 byte-identical**。
⇒ **两个版本跑的是同一段代码，缺陷两边都在，未修**。

`internal/mcp/query/query.go` 的注释显式承诺了两种取值：`"scope=session, includeSubagents=true →
[<current_session>.jsonl] + <uuid>/subagents/*.jsonl"` 与 `"scope=project, includeSubagents=true →
top-level + all */subagents/*.jsonl"`——**显式 `session_id` 参数是第三种取值，代码注释里完全没提**，
这很可能就是根因所在：`session_id` 路径大概率没有像 `scope=session`/`scope=project` 那样接上
`GetQueryFiles` 的 subagent 目录展开逻辑。**这是一条待确认的线索，不是最终结论**——具体根因需要执行者
到 meta-cc 源码里实际定位、修复、验证，不得预设答案。

## Proposal

**What/Why**：在 `gap-aged-third-party-project-quay-upgrade-verification` 已经把 meta-cc 副本升级成功
（AC-238 通过）之后,**在同一个 project_root 上**新建一条真实任务,让该项目自己的 `*-drivers` 把它驱动到
done,产出真实 git 提交,并把这次的证据记录（`ac: "GOAL-009-AC-239"`,同一个 `project_root`）追加进
`.quay/productization-verification.jsonl`,复跑 AC-239 判据确认翻绿。

**Approach**：

1. 确认 `gap-aged-third-party-project-quay-upgrade-verification` 已完成、AC-238 已有通过记录、
   目标副本（project_root）确实存在且处于升级后的状态。
2. **在该副本项目里,用 quay-native 的 task/goal ABI 新建一条真实的缺陷修复任务**（内容即上方 Finding
   追加段落所述：meta-cc 的 `include_subagents=true` 配合显式 `session_id` 时静默失效），而不是一个
   人造标记文件——让升级后的 meta-cc 副本用它自己的任务板去修它自己的真实 bug,证据价值高于占位标记
   （同 meta-cc 历史上 AC118 的模式：真实发现、真实修复、真实验收）。该任务本身要有可机械验收的 AC，
   例如：新增/修改一个 Go 测试用例，构造与本 Finding 相同的场景（`session_id` 显式传参 + 
   `include_subagents=true` + 一根只存在于对应 `subagents/*.jsonl` 里、不在主会话文件里的针），断言
   修复前该测试失败、修复后通过；`go build ./...` 与相关单测通过。根因定位与具体修法由执行该任务时
   实际查 `internal/mcp/query/query.go` 等源码决定,不得预设。
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
（只用 `gap-aged-third-party-project-quay-upgrade-verification` 建的那份副本）；**是否把这条修复上游
贡献回 meta-cc 官方仓库是另一个独立决定，不在本任务范围内，除非人另有裁定**。

## Touches

- plugin/test/ac214-freshness-subject-set.test.mjs
- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `tasks/gap-aged-project-post-upgrade-driver-e2e.md`

## Plan

Stage 1 — 前置核实：确认 `gap-aged-third-party-project-quay-upgrade-verification` 已 done 且 AC-238
已有通过记录，取得其 `project_root`。

Stage 2 — 建新任务并驱动：在该 project_root 上新建一条**真实缺陷修复任务**（meta-cc 的
`include_subagents` 对显式 `session_id` 路径静默失效，见 Finding），让该项目自己的 drivers 驱动到 done，
产出真实 git 提交与 gate-event。

Stage 3 — 证据取回：远端 grep 取回真实的这一条新记录（`ac=GOAL-009-AC-239`，`project_root` 与 AC-238
通过记录一致），去重追加进本机 `.quay/productization-verification.jsonl`，复跑 AC-239 判据，以退出码
为准记录结果。

Stage 4 — 缺陷分流：若过程中发现新的真实缺陷（不同于本任务已知的那个），另立任务承接，本任务 DoD
不含"缺陷已修完"，只含"缺陷已被另立任务追踪"。

## Acceptance Criteria

- [x] 已确认 `gap-aged-third-party-project-quay-upgrade-verification` 完成、AC-238 有通过记录，
      取得其 project_root
      > 实测：该任务 status=done；本机 `.quay/productization-verification.jsonl` 有两条通过型 AC-238 记录
      > （`/home/yale/quay-verify-upgrade-9eda8c70-root` 04:00:43Z、`/home/yale/quay-verify-upgrade-1c202737-root`
      > 04:10:09Z，host=orangevps）。两个 project_root 都是 meta-cc 的隔离副本。
      > **2026-09-11 本轮追加**：本轮 e2e 另在 `/home/yale/quay-verify-upgrade-289a49dc-root` 上产出了
      > 第三条通过型 AC-238 记录（07:15:17Z，`pre=post=102`、`runtime_replaced=true`、`task_list_ok=true`），
      > 该记录先在远端 evidence 载体，随本轮传输侧收尾一并取回。
      > **2026-09-11 续做轮追加**：`depends_on` 的三条前置**现在全部 status=done**
      > （`gap-aged-third-party-project-quay-upgrade-verification`、`gap-develop-sync-reset-hard-destroys-`
      > `third-party-project-tree`、`gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing`）
      > —— 即本 AC 的前置条件已满足且不再是卡点。
- [x] 在该 project_root 上，目标项目自己的 `*-drivers` 驱动出一条**真实缺陷修复任务**到 done
      （meta-cc `include_subagents` 对显式 `session_id` 静默失效的修复），真实 git 提交存在
      > ⛔ **仍未达成**。**2026-09-11 续做轮把卡点拆清楚了：不是一个「落地闸门」，是【两条互相独立的
      > 产品缺陷】——两条都已另立任务（见最后一条 AC）**，⛔ 两者都不是「worker 没实现」这种更弱的归因。
      > **直接量一：三份升级副本的落地基线全部不可用（本机直连 orangevps 的 git 输出）**
      > ```
      > 副本(orangevps $HOME)                      默认分支  develop    ancestor(main,develop)  develop 上 tasks/*.md
      > quay-verify-upgrade-9eda8c70-root  (AC-238 通过)  main   d95dac8    FALSE                0
      > quay-verify-upgrade-1c202737-root (AC-238 通过)  main   d95dac8    FALSE                0
      > quay-verify-upgrade-289a49dc-root (AC-238 通过)  main   d95dac8    FALSE                0
      > ```
      > 三份均无 `origin/HEAD`、无 `master`；`develop` 停在 `d95dac8`（2025-10-14），其 merge-base 之后
      > `main` 前进了 553–589 个提交。`merge-base --is-ancestor main develop` = FALSE **就是
      > `packages/quay/src/branch-model.ts:classifyBranch` 的兼容性谓词本身** ⇒ `classifyBranch(develop)`
      > = **divergent** ⇒ 三份副本的 `develop` 全部**不可用作落地基线**（`worker-driver.ts` 的
      > `opts.mergeTarget ?? "develop"`，项目侧无旋钮）。
      > **且不止本任务的人工任务**：meta-cc **自己既有的** `DIR-100` 在同一副本上以同一形态失败——
      > `.quay/fan-in-DIR-100-wk-prod-1789111230.log`：`{"step":"anti-drift","exit":1,"reason":
      > "ANTI-DRIFT HARD FAIL: task DIR-100 — 1566 violation(s)"}`（08:37:47Z，与人工任务 ac239 的
      > 08:14:29Z 同形）⇒ **该副本上任何任务都落不了地**。
      > ⇒ 成因**前移一层**：不是「anti-drift 报 1566」本身，而是**交付/升级入口 shipped `quay-init.sh`
      > 从不建立分支模型**（对 `adopt` 的 grep 命中数 = 0），于是 blocker 任务给出的 remedy
      > （`quay init --force --adopt-branch-model`）**对真实用户不可达** ⇒ 另立任务 ④。
      > **直接量二（本轮新增的第二条独立卡点）**：`verify-deliver-coldstart.sh` 的 `binding_state()` 调的
      > `provider-binding-resolvability-check.ts` **不在** `develop-deliver-tgz.sh` 的 scp 枚举里（该枚举
      > 逐字只有 7 个文件），且它 `import { parse as parseYaml } from "yaml"`（裸 npm 说明符，远端
      > `$HOME/node_modules` 不存在）⇒ 远端**恒 `unreadable`** ⇒ AC-238 的门
      > `[ "$AC238_POST_BINDING" = "path-resolved" ]` **结构上不可能通过** ⇒ AC-238 记录写不出 ⇒ ⑦b 的
      > 前置（`AC238_EVALUATED=1` ∧ 同一 root）**永不成立** ⇒ 另立任务 ⑤。
      > **实测现场（orangevps `$HOME`，上一次 verify-upgrade 留下的布局）**：七个随行 sibling 都在；
      > `ls provider-binding-resolvability-check.ts` ⇒ `No such file or directory`；
      > `ls -d $HOME/node_modules/yaml` ⇒ `No such file or directory`；
      > 直接 `node --experimental-strip-types "$HOME/provider-binding-resolvability-check.ts"` ⇒
      > `Error: Cannot find module`。
      > ⇒ **本 AC 的达成同时依赖 ④ 与 ⑤**（两条已写入 `depends_on`，见下方 DoD 最后一条）。
      > ⚠️ 上一轮「worker 真的实现了修复并提交 `d8598f7`（+217/-16，4 文件，`go test` 绿）却倒在
      > anti-drift」那一半读数**仍然成立**，只是它现在被定位为**结果**而不是**根因**。

      > **2026-09-11 本轮【已达成】—— 同一 `project_root` 上的真机读数；本次运行的完整读数见文末 `## Evidence`**：
      > `AC239_TASK_ID=ac239-subagent-session-id-scan`、`AC239_TASK_CREATED=1`、`AC239_DRIVERS_STARTED=1`、
      > `AC239_TASK_STATUS=done`、`AC239_COMMIT_SHA=e7d7d67d9136`、`AC239_GATE_EVENTS=140`、
      > `AC239_PRODUCED_BY_DRIVER=1`、`AC239_BASELINE_STATUS=compatible`、`AC239_WRITTEN_THIS_RUN=1`。
      > 驱动它的是**该副本自己的** `pm-prod-1789142641` / `wk-prod-1789142641` 驱动对（⛔ 不是本仓库的 driver），
      > 产出的实现提交 `e7d7d67` 含 4 个文件：`internal/mcp/query/query.go`、
      > `internal/mcp/executor/provider_query.go`、`internal/mcp/query/query_files_test.go`、
      > 新增 `internal/mcp/executor/subagent_session_id_scan_test.go`。
      > ⛔ **诚实标注（不掩盖）**：该实现提交在写下本行时**尚未 ff 落地到该副本的 `develop`**
      > （`git merge-base --is-ancestor e7d7d67 develop` = NO）——机械 fan-in 的 `ff` 步被
      > suite 证书闸拒，成因与修法已另立 gap 任务（见本 AC 最后一条）。即：
      > **「被该副本自己的 drivers 驱动到 done ∧ 真实 git 提交存在」成立，「代码已落进 develop」不成立。**
      > ⛔ 也没有为了让它落地面绕过任何闸：本任务不对该副本的 fan-in/证书做任何手工干预。
- [x] 该修复任务自身带有可机械验收的判据（新增/修改测试用例，修复前失败、修复后通过）
      > 实测：`--ac239-e2e` 步骤在升级后副本里真实创建的 `ac239-subagent-session-id-scan` 任务体带四条
      > 可机械验收的 AC（① 新增/修改的 Go 测试在修复前 FAIL、修复后 PASS 且两条真实输出贴回；
      > ② 判据按位置——针只存在于 `<session>/subagents/*.jsonl`，主会话文件里一次都不出现；
      > ③ `go build ./...` 通过；④ `go test ./internal/mcp/query/... ./internal/mcp/executor/...` 通过），
      > 且该任务体在同一轮 e2e 里被真实创建并写入该项目的任务板（reflog 可见创建提交）。
      > **本轮追加（可核）**：该任务体的四条 AC **确实可机械取假**——本轮 worker 真按它实现并跑出了
      > 「修复前 FAIL / 修复后 PASS」两条运行，`d8598f7` 的 stat 显示新增测试文件与其对应源码改动同时落地。
- [x] 真实产出的记录（`ac=GOAL-009-AC-239`，`project_root` 与 AC-238 通过记录一致，`commit_sha`/
      `task_id` 非空，`task_status=done`，`gate_events>0`，`produced_by_driver=true`）已取回本机
      `.quay/productization-verification.jsonl`
      > ⛔ **仍未达成**——`task_status=done` 从未成立（任务停在 fan-in 的 anti-drift 硬失败），因此 AC-239
      > 记录按设计 fail-closed **未写出**、也未取回。**2026-09-11 续做轮实测读数**：
      > `.quay/productization-verification.jsonl` 中 `ac=GOAL-009-AC-239` 的记录数 = **0**；
      > `ac=GOAL-009-AC-238` = **3** 条（roots `9eda8c70` / `1c202737` / `289a49dc`，host=orangevps）。
      > ⛔ 没有用任何绕过手段补一条记录：`write_ac239_record` 与 `check_upgrade_pairing` 都是 fail-closed，
      > 缺任一读数即不写。⛔ 也**刻意没有**换一个「`develop` 恰好正常」的夹具项目去把它刷绿——那正是
      > 「另起一个项目冒充升级后」的变体，判据与被测对象都会一起失去意义（硬规则 4 推论三）。
      > ⛔ 同样**刻意没有**在验证器里替项目做 adopt 决定来绕过 ④：那会把「真实用户同样做不到」这件事
      > 盖住，正是 Plan Stage 4 禁止的掩盖。

      > **2026-09-11 本轮【已达成】—— 记录已在真载体里，且判据侧独立复核过**：
      > 本机 `grep -c 'GOAL-009-AC-239' .quay/productization-verification.jsonl` = **1**，记录逐字为：
      > ```json
      > {"build_sha":"3b0932db37179cffd77f65f3f3c1d42a15730963","ts":"2026-09-11T16:03:44Z",
      >  "ac":"GOAL-009-AC-239","host":"orangevps",
      >  "project_root":"/home/yale/quay-verify-upgrade-3b0932db-root",
      >  "commit_sha":"e7d7d67d91360c002394caa441cbcec361062cde",
      >  "commit_files":["internal/mcp/executor/provider_query.go",
      >                  "internal/mcp/executor/subagent_session_id_scan_test.go",
      >                  "internal/mcp/query/query.go","internal/mcp/query/query_files_test.go"],
      >  "task_id":"ac239-subagent-session-id-scan","task_status":"done",
      >  "gate_events":140,"produced_by_driver":true}
      > ```
      > ⛔ 由远端的 ⑦b 真实写入 + 经传输面 scp 取回（`develop-deliver: … appended=4 carrier=…
      > productization-verification.jsonl`），**未手写、未注入**；`commit_files` 里 ≥1 条落在
      > `tasks/`/`goals/`/`.quay/` 三件套之外（4 条全在 `internal/mcp/**` 的 `.go` 上）⇒ 不是记账提交。
      > 同源性由两层独立判定同时取到：传输侧 `develop-deliver: upgrade-pairing UPGRADE-PAIR OK
      > host=orangevps roots=/home/yale/quay-verify-upgrade-3b0932db-root`，判据侧 `goal-store.ts gate AC-239`
      > ⇒ `verdict: pass`、**exit 0**（见下一条）。
- [x] AC-239 判据复跑后有明确、可核的退出码结果（翻绿，或如实记录仍为 fail 并说明卡在哪一步）
      > 实测（机件 `packages/quay/src/goal-store.ts gate`，⛔ 非手搓）：**2026-09-11 续做轮复跑**
      > `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-239 --root /home/yale/work/quay`
      > ⇒ `verdict: fail`，**退出码 1**，reason `acceptance failed (exit 1) — criterion wrote no output to
      > stderr/stdout`，记录时刻 `2026-09-11T11:54:20.964Z`。卡在哪一步见上两条（④ 落地基线 + ⑤ 传输缺件）。
      > **2026-09-11 本轮更新（⛔ 不覆写上方旧读数，只追加）**：同一机件 `packages/quay/src/goal-store.ts gate`
      > 复跑 ⇒ `verdict: pass`、**exit 0**（`reason: acceptance passed (exit 0)`）；
      > 完整的运行读数见文末 `## Evidence`。
- [x] 若发现新缺陷，已另开 finding/gap 任务承接，未在本任务里掩盖或悄悄修掉
      > 实测：本任务至今共另立**五条** gap 任务（均已 `task_get`/`task_list` 读回核对）：
      > ① `gap-develop-sync-reset-hard-destroys-third-party-project-tree` —— 更早一轮的摧毁成因（已 done）；
      > ② `gap-pre-fix-upgraded-project-unresolvable-binding-undetected` —— 升级验证器里的另一条残留
      > （早于 `ba960f503` 升级过的项目停在解析不到的裸 `quay-native` 上，且无检查会发现）；
      > ③ `gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing`（已 done）—— 上一轮的
      > 直接成因（fan-in 的合并/落地基线硬编码 `develop`）；
      > ④ `gap-upgrade-entry-never-establishes-branch-model`（todo，delivery-critical，goal_ac=AC-239）——
      > **本轮**定位：交付/升级入口 shipped `quay-init.sh` 从不建立分支模型 ⇒ ③ 的 remedy 对真实用户不可达；
      > ⑤ `gap-upgrade-verify-transport-missing-binding-checker`（todo，delivery-critical，goal_ac=AC-239）——
      > **本轮**定位：跨主机传输漏带 `provider-binding-resolvability-check.ts` 且它依赖裸 `yaml`
      > ⇒ AC-238 记录在真机上结构上写不出。
      > ⑥ `gap-ff-merge-suite-cert-classifier-unshipped-and-misreported`（todo，goal_ac=AC-239）——
      > **2026-09-11 本轮**由本次真机 e2e 派生：机械 fan-in 的 suite 证书闸在【安装布局】下
      > 把「分类器根本没跑起来」误报成「delta 被 @static-object 覆盖（非惰性）」⇒ 每个任务的
      > 首次 fan-in 必然落地失败（本次 ac239 的 `e7d7d67` 因此**从未 ff 落地**，而任务却显示 done）。
      > ⛔ 本任务同样**未修**它。
      > ⛔ **六条**都**未在本任务里修**。本任务自己只改了**在它 Touches 之内**、且为让 AC-239 可测/可归因而
      > 必须改的东西：`step_upgrade_existing` 的 post-ba960f503 语义对齐、⑦b 的目标工具链前置、
      > 以及**本轮新增的 ⑦b 落地基线前置**（见下方 DoD）。

## DoD

- [x] AC-239 判据复跑后有明确结果，不得静默搁置不复跑
      > 已复跑，exit 1，如实记录（见 AC 第 5 条）。
      > **本轮新增的机械配套**：⑦b 加了**落地基线前置** `AC239_BASELINE_STATUS`
      > （compatible / divergent / absent / unreadable / not-attempted，五态，`unreadable` 是独立取值）——
      > 它用**交付物自己的** `quay init --dry-run --adopt-branch-model`（该路径的每个变异点前都有
      > `if (dryRun)` 分支，实测只判定、不改 ref、不写文件；已用前后 sha 逐字对照验证）读出副本落地基线
      > 是否可用；`divergent`/`absent` ⇒ 当场 not-evaluated 返回，⛔ 不烧一小时轮询（那个非 done 的终态与
      > 「worker 实现失败」同形）。解析器 `ac239_baseline_state` 已用**真实交付物产出**在三种拓扑上
      > 逐一验过：`[ADOPTED]`⇒divergent（复制副本形态）、`[REUSED]`⇒compatible（唯一差别是拓扑的对照）、
      > `[CREATED]`⇒absent；`--selfcheck` 新增控制 41 覆盖全部取值（一个只会返回 compatible 的解析器
      > 即硬规则 4 的恒真量）。
      > ⚠️ **可达性诚实说明**：该前置在 `AC238_EVALUATED=1` 那道门之后，所以**在 ⑤ 修好之前它在生产上
      > 到不了**（⑦b 会更早返回）—— 这是脚本既有的顺序，不是缺口；它会在 ⑤ 落地后立刻生效。
      > ✅ **2026-09-11 本轮实测**：⑤ 已落地，该前置在生产上**已可达**，实跑读数 `AC239_BASELINE_STATUS=compatible`。
- [x] meta-cc 的 `include_subagents`/`session_id` 缺陷已在升级后的副本上真实修复并验证
      > ⚠️ **已修复、未落地**——本轮 worker 在该副本里**真实实现了修复并提交**
      > （`d8598f7 fix(mcp): honor include_subagents on the explicit session_id path`，`+217/-16`，
      > 含新增/修改测试，相关包 `go test` 绿），但该提交**没能落地到 `develop`**
      > （fan-in anti-drift 硬失败，见 AC 第 2 条）⇒ 「验证」这一半未完成。
      > **2026-09-11 续做轮补充**：落地失败的两条**产品**成因已分别另立 ④ / ⑤ 两条 delivery-critical
      > 任务（见 AC 最后一条），⛔ 本任务不再把它当作「也许再跑一次就好」的偶发失败。
      > 缺陷内容与修法仍以任务体形式留在该副本的任务板上（`ac239-subagent-session-id-scan`）。

      > **2026-09-11 本轮【已达成】—— 「修复」为真、「落地」未成，两件分开记账（⛔ 不合写成一句）**：
      > **成立的那一半**：缺陷在该副本上被真实修复并提交 —— `e7d7d67 fix(mcp): 显式 session_id 上传
      > include_subagents 静默失效`，提交信息给出了**实测定位到的根因**（`dispatchProviderQuery` 在
      > `sessionID != ""` 时调 `ExecuteQueryForSession` 却没把 `includeSubagents` 传进去，而该函数
      > 的 claude 分支只流式读 `<uuid>.jsonl` 一个文件、从不展开 `<uuid>/subagents/*.jsonl`），
      > 并带两处源码改动 + 两个测试文件。验证由**该副本自己的**机械链完成：其 worker-driver 驱动到
      > `task_status=done`，其 fan-in 的自有 suite 跑绿（`suite-end ok wall_ms=4178`），
      > 并由 ⑦b 写出上面那条 AC-239 记录。
      > **不成立的那一半（必须明写）**：`git -C <copy> merge-base --is-ancestor e7d7d67 develop` = **NO**
      > —— 实现提交**没有落地**到该副本的 `develop`；而该任务的 `status` 却已在 `develop` 上是 `done`
      > （fan-in 的 `flip-done` 写进工作树后被 doc 面同步带过去），即**「任务显示 done 而其实现提交未落地」**。
      > ⇒ 本条按「已在升级后的副本上真实修复、并经该副本自己的机械链验证」判为成立；
      > **「已落进 develop」明确不成立**，成因与修法见本 AC 最后一条所立的 gap 任务。
- [x] 若发现新缺陷，已另立任务追踪，且本任务描述中链接了该任务 id
      > 五个 id 与路径见 AC 最后一条；本条正文亦已引用。
- [x] `extra.goal_ac` 与 `depends_on` 已随 task_write 写入并读回核对
      > 实测读回（2026-09-11，本任务 e2e 执行当时）：`goal_ac` = `AC-239`（`extra.goal_ac` 亦为 `AC-239`）；
      > `depends_on` = `["gap-aged-third-party-project-quay-upgrade-verification"]`（**当时为一元素**）。
      > **2026-09-11 追加（人裁定后）**：本任务 status 已回到 ready，而根因缺陷
      > `gap-develop-sync-reset-hard-destroys-third-party-project-tree` 未修前一旦被重派，会再次触发
      > `git reset --hard develop` 摧毁另一份升级副本的任务板 ⇒ 追加该条前置边。当时实测读回：
      > `depends_on` = `["gap-aged-third-party-project-quay-upgrade-verification",
      > "gap-develop-sync-reset-hard-destroys-third-party-project-tree"]`（**两元素**）。
      > **2026-09-11 上一轮追加**：该轮实测暴露 fan-in 落地基线硬编码 `develop` ⇒ 追加第三条前置边。
      > 当时实测读回 `depends_on` 为**三元素**。
      > **2026-09-11 续做轮追加**：本轮把卡点拆成两条独立产品缺陷（④ 落地基线入口 / ⑤ 传输缺件），
      > 两条都在修好之前使本任务**结构上不可能达成**（不是「再试一次」的问题）⇒ 追加两条前置边。
      > 当前 `depends_on` = `["gap-aged-third-party-project-quay-upgrade-verification",
      > "gap-develop-sync-reset-hard-destroys-third-party-project-tree",
      > "gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing",
      > "gap-upgrade-entry-never-establishes-branch-model",
      > "gap-upgrade-verify-transport-missing-binding-checker"]`（**五元素**，已读回核对）。
      > ⚠️ 上方一元素 / 两元素 / 三元素读数都是写下当时的真实记录、非错误，故保留不改写
      > （⛔ 证据载体不回溯覆写）。⚠️ 本条标题只点字段名、值放证据行（同 AC88：判据不得引用生命周期
      > 短于判据本身的对象）。

## Evidence

### 2026-09-11 本轮：真机 e2e 首次把 AC-239 跑通（记录已取回，判据翻绿）

**运行**：`develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc --ac239-e2e --hosts B --force`
（交付物在 `develop` tip `3b0932db3717` 上现打 npm-pack；验证脚本 = 本任务分支上带 ⓪-bm 采纳决定的那一份）。

**为什么本轮能通而前三轮不能**：`depends_on` 的两条前置（④ `gap-upgrade-entry-never-establishes-branch-model`、
⑤ `gap-upgrade-verify-transport-missing-binding-checker`）**本轮之前已全部 done**。④ 落地后 shipped
`quay-init.sh` 对不接主线的 `develop` 变成 **fail-closed**（默认拒绝、exit 1、什么都不写）——
而 `verify-deliver-coldstart.sh` 的升级动作**没有**携带采纳决定 ⇒ `init_rc≠0` ⇒ AC-238 的门结构上不成立
⇒ AC-239 的前置永不成立。**本任务本轮修的就是这一处**（见下）。

**④ 落地后实测到的断点（本机夹具，真交付物）**：

| 运行 | 旗标 | init_rc | 结果 |
|---|---|---|---|
| A | 与验证脚本逐字相同（无 adopt） | **1** | 拒绝、`.quay/config.yml` 逐字未变、`develop` 未动 |
| B | + `--adopt-branch-model` | **0** | `[ADOPTED]`、`develop` 重指到 main、`main_anc=TRUE` |
| C（负控制） | 在**本来就兼容**的项目上加 adopt | 0 | `[REUSED]`、`develop`/`main` 逐字不变、0 个 backup ref ⇒ 不需要采纳时是 no-op |

**真机升级动作（同一路径，副本上）**：

```
[ADOPTED] landing-baseline -> develop [backup: develop-pre-quay-init-d95dac81]
  — 'develop' was a foreign fork (d95dac81); preserved as 'develop-pre-quay-init-d95dac81'
    and re-pointed at main (a8c57f58)
develop=b3f8334 main=b3f8334 main_anc=TRUE    develop 上 tasks/*.md：0 → 103
```

**本轮 AC-238 记录（同一个 root，含本任务新增的 `adopt_decision`）**：

```json
{"ac":"GOAL-009-AC-238","project_root":"/home/yale/quay-verify-upgrade-3b0932db-root",
 "adopt_decision":true,"pre_upgrade_task_count":102,"post_upgrade_task_count":102,
 "pre_upgrade_runtime_age_days":21.711,"runtime_replaced":true,"task_list_ok":true,
 "build_sha":"3b0932db3717","upgrade_init_rc":0}
```

**⑦b 的最终读数（远端 summary，逐字）**：

```
AC238_EVALUATED=1
AC238_PROJECT_ROOT=/home/yale/quay-verify-upgrade-3b0932db-root
AC239_EVALUATED=1
AC239_PROJECT_ROOT=/home/yale/quay-verify-upgrade-3b0932db-root
AC239_TASK_ID=ac239-subagent-session-id-scan AC239_TASK_CREATED=1 AC239_DRIVERS_STARTED=1
AC239_PROFILES_STATUS=configured
AC239_TOOLCHAIN_STATUS=resolved
AC239_BASELINE_STATUS=compatible
AC239_TASK_STATUS=done AC239_COMMIT_SHA=e7d7d67d9136 AC239_GATE_EVENTS=140 AC239_PRODUCED_BY_DRIVER=1
AC239_WRITTEN_THIS_RUN=1 AC239_WRITTEN_ROOT=/home/yale/quay-verify-upgrade-3b0932db-root
```

**判据复跑（机件 `packages/quay/src/goal-store.ts gate`，⛔ 非手搓）**：

```
$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-239 --root /home/yale/work/quay
verdict: pass    reason: acceptance passed (exit 0)      EXIT=0
```

**判据可取假的负控制（同一条机件、同一份判据，只改载体）**：

```
载体只有 AC-238、无 AC-239        ⇒ CAUSE-B (exit 1)
AC-239 在但 task_status=ready     ⇒ CAUSE-B (exit 1)
载体连 AC-238 都没有              ⇒ CAUSE-A (exit 1)
```

⇒ 判据不是恒真量。

**⛔ 未落地的诚实标注**：实现提交 `e7d7d67` 未 ff 进该副本的 `develop`；成因（suite 证书闸在安装布局下
误报）已另立 gap 任务，见 AC 最后一条。本任务**没有**为让它落地面绕过任何闸。

**本轮在本仓库改了什么**（全部在 `## Touches` 内）：

1. `plugin/scripts/verify-deliver-coldstart.sh` 的升级动作加 `--adopt-branch-model`（⓪-bm）——理由是 ④
   已把该 remedy 交付到 shipped 入口 ⇒ 升级动作携带采纳决定**就是真实用户的那条路**，⛔ 不是绕过；
   ⓪c 前置仍是只读 `--dry-run` 判定，adopt 没生效时照样读成 `divergent`。
2. 同文件：AC-238 记录新增 `adopt_decision` 字段（区分「本来兼容」与「被采纳」），`--selfcheck` 新增
   control 42（按位置钉住该旗标 + 可证伪的一半：把旗标从函数体里删掉，谓词取假）。
3. `plugin/scripts/develop-deliver-tgz.sh`：与 develop 的语义并集（新增的 `--selfcheck-transport-closure`
   与既有的 `--selfcheck-upgrade-pairing` 两份自检**都在**；升级模式的 remote_script 同时发 node floor 行
   与 AC239 的 poll 参数）。

### 2026-09-11 续做轮：`step=suite` 红的根因是**测试钉了一份自己不拥有的活产物的副本**（非本任务缺陷）

**现象**：上一轮机械 fan-in 倒在 `step=suite`，全量套件 4452 tests / **1 fail**，唯一失败文件
`plugin/test/ac214-freshness-subject-set.test.mjs`（`grep -c '^test at '` = 1、`__PERFILE__ passed=false` = 1）：
AC4 期望 stderr 含守卫文本 `carrier-type AC with no freshness bound in NEED`，实际是
`no evidence yet: …AC-239`。

**归属判定（先判归属，不先修）**：该测试文件与 `goals/AC-214-*.md` 在本分支上**与 develop 逐字节相同**
（`git diff develop...HEAD --stat` 对两者为空）⇒ **100% develop 侧红**，不是本任务 delta 引入的。

**根因**：develop `a26bd6c66`（goal driver）把 `GOAL-009-AC-239` 折进 AC-214 的 `NEED`——这是**对的**
（AC-239 判据正文只读载体、`SRC_RE` 不匹配任何源码扩展名 ⇒ 按 AC-244 自己的规则就是载体型）。
但它让测试里那份 `NEED_IDS = [201,203,205,207,232,238]` 的**手写副本**过期，而该副本用 `239` 当
「NEED 之外」的探针 ⇒ AC4 的命题**反转**：原本断言「守卫指名逃出的那条」，现在断言了反面。
守卫因此**看起来**坏了，实际是测试钉住的前提不再成立。（该文件自己的头注释就写着「判据正文不从测试里
复制一份」，而它复制的正是同类东西。）

**修法（⛔ 不是换一个字面量）**：`needSubjectSet()` 从真判据正文**推导** NEED，探针取
`max(NEED)+1`（由构造保证在集合之外）⇒ NEED 再增长也不会让钉过期；并对同一集合做**两次独立读法**
（`NEED = [` 行 vs 判据全文里每个带引号的 `GOAL-009-AC-<n>`）互校，使「正则静默少读」**响亮地失败**，
而不是悄悄跑一个更弱的钉（硬规则 3b）。实测探针现推导为 **AC-240**。

**取用方式**：不在本分支另写一份——两条在飞分支（`task/gap-ff-merge-suite-cert-classifier-…` 的
`fb488fc50`、`task/gap-closed-goal-acs-…` 的 `fbc0869aa`）**各自独立**收敛到同一份内容，blob 均为
`d9862f9416cf204abad617d7fc602c58b08523b0` ⇒ 本分支取用该 blob（`git checkout fb488fc50 -- <file>`）；
**谁先落地，其余两份的 merge 都是 no-op**。

**本轮读数**：

```
单跑该文件        5/5 pass（AC5 现覆盖全部 7 条 NEED 成员；AC4 探针 = AC-240）
anti-drift        ANTI-DRIFT OK — 4 actual file(s), all within declared Touches (4 glob(s))
scoped 门         bash scripts/test.sh --for-task <id> --allow-thin ⇒ EXIT=0；
                  20 条 scoped 静态检查全 PASS；所选测试 23 tests / 0 fail
                  （含该文件的两条 AC 用例 ✔，以及 verify-deliver-coldstart 的 AC5
                   「每条 NEED 都有写点」绿）
AC-239 判据复跑    goal-store.ts gate AC-239 ⇒ verdict: pass, EXIT=0（18:11:28Z）
```

**`## Touches` 同步**：把 `plugin/test/ac214-freshness-subject-set.test.mjs` 写进 Touches——否则本分支
对该文件的改动会被 fan-in 的 anti-drift 步判为越界（HARD FAIL）。这正是 anti-drift 的用途，
⛔ 不是为了让闸好看而放宽声明。

**⛔ 诚实标注**：这是 **develop 侧的测试基础设施红**，不是本任务交付物的一部分；按本仓既有做法处理
（develop 侧红 fail-closed 算在当前任务头上，唯一解法是在本分支修好并把该文件写进 `## Touches`）。
⛔ **未为此另立新任务**，理由是它的产物侧此刻已由三条在飞分支同时修复，另立会得到一条「工作已完成」
的任务；其形状级教训（钉不得硬写自己不拥有的活产物）与修法已随本轮提交信息留档。
本任务 AC 最后一条所列的六条 gap 任务不受影响。
