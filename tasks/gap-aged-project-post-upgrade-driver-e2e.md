---
id: gap-aged-project-post-upgrade-driver-e2e
title: 升级后闭环验证：driver 在已升级的旧痕迹项目（meta-cc 副本）上继续驱动新任务到 done
status: ready
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
- [ ] 在该 project_root 上，目标项目自己的 `*-drivers` 驱动出一条**真实缺陷修复任务**到 done
      （meta-cc `include_subagents` 对显式 `session_id` 静默失效的修复），真实 git 提交存在
      > ⛔ **未达成**——本次真机 e2e 在同一个 project_root 形态上（`/home/yale/quay-verify-upgrade-5ddbcf80-root`）
      > 实测到一条**新缺陷**并把这次驱动摧毁在半路：任务已真实创建（`50e5d2d tasks: ac239-subagent-session-id-scan
      > task_write by cli:2329001`）并被该项目自己的 promotion-driver 真实晋升
      > （`794ab28 … todo→ready（promotion-driver 机械晋升）`），但同一次任务提交触发的
      > `syncDocDevelopBidirectional` 走了终局解 `takeDevelopDiscardingDoc`（`git reset --hard develop`），
      > 把该项目 `main` 上的 **50 个提交**（含三个 release 提交）与**全部 102 个任务文件**判为可丢并清除
      > （`tasks/*.md` 计数 → 0，`.quay/config.yml` 一并消失），驱动随后服务一棵没有任务板的树。
      > 判据侧读数：AC-239 criterion 复跑 **exit 1**（见下一条）。新缺陷已另立任务（见最后一条）。
      > 详见 `/home/yale/work/quay/tasks/gap-develop-sync-reset-hard-destroys-third-party-project-tree.md`。
- [x] 该修复任务自身带有可机械验收的判据（新增/修改测试用例，修复前失败、修复后通过）
      > 实测：`--ac239-e2e` 步骤在升级后副本里真实创建的 `ac239-subagent-session-id-scan` 任务体带四条
      > 可机械验收的 AC（① 新增/修改的 Go 测试在修复前 FAIL、修复后 PASS 且两条真实输出贴回；
      > ② 判据按位置——针只存在于 `<session>/subagents/*.jsonl`，主会话文件里一次都不出现；
      > ③ `go build ./...` 通过；④ `go test ./internal/mcp/query/... ./internal/mcp/executor/...` 通过），
      > 且该任务体在同一轮 e2e 里被真实创建并写入该项目的任务板（reflog 可见创建提交）。
- [ ] 真实产出的记录（`ac=GOAL-009-AC-239`，`project_root` 与 AC-238 通过记录一致，`commit_sha`/
      `task_id` 非空，`task_status=done`，`gate_events>0`，`produced_by_driver=true`）已取回本机
      `.quay/productization-verification.jsonl`
      > ⛔ **未达成**——`task_status=done` 从未成立（驱动被上一条的缺陷摧毁在半路），因此 AC-239 记录
      > 按设计 fail-closed **未写出**、也未取回。`.quay/productization-verification.jsonl` 中
      > `ac=GOAL-009-AC-239` 的记录数 = **0**（实测 grep）。⛔ 没有用任何绕过手段补一条记录：
      > 新增的 `write_ac239_record` 与 `check_upgrade_pairing` 都是 fail-closed，缺任一读数即不写。
      > ⚠️ 卡在哪一步：升级成功 → 真实任务创建/晋升成功 → **驱动到 done 之前**被
      > `git reset --hard develop` 摧毁任务板。这是**判据的失败**（AC-239 对 meta-cc 形态项目被证否），
      > 不是"没跑成"。
- [x] AC-239 判据复跑后有明确、可核的退出码结果（翻绿，或如实记录仍为 fail 并说明卡在哪一步）
      > 实测（机件 `packages/quay/src/goal-store.ts gate`，⛔ 非手搓）：
      > `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-239 --root /home/yale/work/quay`
      > ⇒ `verdict: fail`，**退出码 1**，reason `acceptance failed (exit 1)`。
      > 卡在哪一步见上两条（驱动到 done 之前被 `git reset --hard develop` 摧毁任务板）。
- [x] 若发现新缺陷，已另开 finding/gap 任务承接，未在本任务里掩盖或悄悄修掉
      > 实测：本轮共另立两条 gap 任务（均已 `task_get` 读回核对）：
      > ① `gap-develop-sync-reset-hard-destroys-third-party-project-tree` —— 本次 AC-239 被摧毁的直接成因；
      > ② `gap-pre-fix-upgraded-project-unresolvable-binding-undetected` —— 升级验证器里的另一条残留
      > （早于 `ba960f503` 升级过的项目停在解析不到的裸 `quay-native` 上，且无检查会发现）。
      > ⛔ 两条都**未在本任务里修**（本任务只修了为让 AC-239 可测而必须对齐的
      > `step_upgrade_existing` 语义，见下方 DoD 说明）。

## DoD

- [x] AC-239 判据复跑后有明确结果，不得静默搁置不复跑
      > 已复跑，exit 1，如实记录（见 AC 第 5 条）。
- [ ] meta-cc 的 `include_subagents`/`session_id` 缺陷已在升级后的副本上真实修复并验证
      > ⛔ 未达成：驱动在同一刻被 `git reset --hard develop` 摧毁任务板，worker 从未有机会实现该修复。
      > 该修复内容已作为任务体写进升级后副本的任务板（`ac239-subagent-session-id-scan`），一旦
      > ① 的缺陷修好、本任务被重新派发，即可继续。
- [x] 若发现新缺陷，已另立任务追踪，且本任务描述中链接了该任务 id
      > 两个 id 与路径见 AC 最后一条；本条正文亦已引用。
- [x] `extra.goal_ac: "AC-239"` 与 `depends_on: ["gap-aged-third-party-project-quay-upgrade-verification"]`
      已随 task_write 写入并读回核对
      > 实测读回：`goal_ac` = `AC-239`（`extra.goal_ac` 亦为 `AC-239`）；
      > `depends_on` = `["gap-aged-third-party-project-quay-upgrade-verification"]`。
