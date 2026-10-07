---
id: gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script
title: CLI 单独完成全新安装的完整闭集写入与项目值检测（把 quay-init.sh 的写入者与检测搬进 TS，遗留检查直接删除而不是搬）
status: needs-human
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-init-surface-unified-no-reconcile-no-force-json-report-serve-defaults-unwritten
goal_ac: AC-331
---
## Proposal
GOAL-029「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」(人 2026-10-07 裁定)。已定决策:终局无 .sh,过渡期 `quay-init.sh` 缩成调用 `bin/quay init` 的垫片(方向:脚本→CLI,不是 CLI→脚本);状态自动决定。判据权威定义:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-331 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`(退出 0 = 达成)。

现状(已读):`quay-init.sh` 的 `write_config`(新装 heredoc)、`detect_test_command`、`detect_tmux_session`、`validate_worktree_root`、`write_profiles_template`、`ensure_gitignore`、`ensure_runtime_artifacts_gitignore`、`write_template`(launch.settings.json)、`write_claude_settings`、`print_install_steps`、`auto_commit_laid_down`、`ensure_target_branch_model` 是 CLI 缺的职责;`init.ts` 已有 `writeClaudeSettings`、`ensureBranchModel`、`refreshProjectPluginLink`;CLI 当前全新写入缺 `.claude/settings.json`、`.gitignore`、`goals/`、安装说明、检测与自动提交(实测 `quay init --root <空仓库>` 缺 `.claude/settings.json`)。脚本里的遗留检查(`derive_loop_scripts`/`verify_referenced_landed`/`compute_drift_report`/`compute_dependency_closure_gaps`/`report_closed_set_state`/闭集指纹/`ensure_vendor_runtime`——后者仅开发树需要)不搬,直接删除;删除前确认其消费者:`plugin/scripts/laydown-set-check.sh` 目前 `source` 脚本取 `derive_loop_scripts`,需改为调用 TS 步骤(`quay-init-steps.ts derive-loop-scripts` 已存在)。

修法:在 `init.ts`/`cli/init.ts` 补齐全新安装的全部写入(config 对空文档应用与升级相同的流水线,不再保留与升级分叉的第二个 heredoc 写者)、检测(测试命令来自 package.json scripts.test 等、tmux 会话、worktree 根校验)、`.gitignore`(含运行时状态条目)、profiles/launch.settings 模板、`goals/` 与 `tasks/` 目录、`.claude/settings.json`、安装说明文本、可选 `--auto-commit-config`、`.quay/plugin` 链接;给 CLI 补齐 `--project`、`--test-command`、`--tmux-session`、`--worktree-root`、`--repo-root`、`--plugin-root`、`--auto-commit-config` 等参数(语义与现脚本一致)。全新写入与升级共用同一份"默认值表"(镜像测试 `plugin/test/quay-init.test.mjs` 对 heredoc 与 `LOOP_VERSION_DEFAULTS` 的钉住随 heredoc 消失而改为对单一来源的断言)。

## AC
- [x] AC-331 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-331 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [x] 取假:删掉 `.claude/settings.json` 的写入或 goals/ 目录创建后判据对应分支变红(附实跑输出)。
- [x] 契约等价:对同一组输入(含 `--test-command`/`--tmux-session`/`--worktree-root`/无 tmux 主机/不可检测测试命令),CLI 的全新安装输出的闭集文件与既有 `plugin/test/quay-init*.test.mjs` 对脚本断言的内容等价——这些测试改为通过 CLI 跑同一组断言并全部通过(逐个列出迁移的用例,保留原意图,不得删用例换绿)。
- [x] `plugin/scripts/laydown-set-check.sh` 不再 `source` `quay-init.sh`;`grep -n "quay-init.sh" plugin/scripts/laydown-set-check.sh` 排除注释后命中数为 0(先打印改前基线);`node --experimental-strip-types --test plugin/test/laydown-set-check.test.mjs` 不比改前更红(该文件在 develop 上本就有 1 个失败,2026-10-07 实测 8/9,完成记录里写明改前改后读数)。
- [x] 遗留检查删除的证据:完成记录列出被删除的每个函数及其消费者检索结果(grep 命中数),确认无活消费者。
- [x] `bash scripts/test.sh --for-task gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:用发布形态产物对一个只有 package.json 的空 git 仓库(临时目录,隔离 HOME)运行 CLI `init` 的全新安装,闭集全部写出、`quay config validate` 与发布门禁断言脚本 `plugin/scripts/verify-plugin-channel-assertions.ts --installed … --project … --scope user` 通过(其中 init 仍可经脚本垫片或直接经 CLI 完成);原始输出贴进完成记录。仅 fixture 绿不算完成。

## Touches
- `packages/quay/src/init.ts`
- `packages/quay/src/cli/init.ts`
- `packages/quay/src/branch-model.ts`
- `plugin/scripts/quay-init-steps.ts`
- `plugin/scripts/quay-init.sh`
- `plugin/scripts/laydown-set-check.sh`
- `plugin/scripts/profiles-role-coverage-check.ts`
- `plugin/test/quay-init.test.mjs`
- `plugin/test/quay-init-tmux-detection.test.mjs`
- `plugin/test/quay-init-loop.test.mjs`
- `plugin/test/laydown-set-check.test.mjs`
- `plugin/test/archive-exclusion-wiring.test.mjs`
- `plugin/test/l1-delivery-surface-check.test.mjs`
- `packages/quay/test/init.test.mjs`
- `packages/quay/test/branch-model.test.mjs`
- `packages/quay/test/mcp-server.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `plugin/sh-census-baseline.json`
- `tasks/gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script.md`

## Evidence
（2026-10-07，worker 轮。worktree `/data/home/yale/work/quay-worktrees/gap-init-cli-lays-full-closed-set`，
分支 `task/gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script`。）

### ① AC-331 实跑退出 0
```
$ bash /tmp/ac331-crit.sh      # 判据原文取自 `quay goal show AC-331 --json` 的 criterion 字段
exit=0
```
（merge develop 之后复跑仍 `exit=0`。）

### ② 取假（两条臂，各附原始输出）
臂 1 —— 删掉 `goals/` 目录创建（`init.ts` 的 `if (!fs.existsSync(goalsDir)) fs.mkdirSync(goalsDir, …)`）：
```
CAUSE=closed-set-dir-missing-goals — the CLI alone must create goals/
exit=1
```
臂 2 —— 删掉 `.claude/settings.json` 的写入（`writeClaudeSettings(settingsPath, …)` 一行）：
```
CAUSE=closed-set-file-missing-.claude/settings.json — the CLI alone must lay the whole closed set (no shell script needed)
exit=1
```
两条改动均已还原（`git diff` 空）。

### ③ 契约等价：迁移的用例（逐个）
驱动面：`plugin/test/quay-init-tmux-detection.test.mjs` / `plugin/test/quay-init.test.mjs` /
`plugin/test/quay-init-loop.test.mjs` 的 `runInit` 现在 spawn
`node --no-warnings --experimental-strip-types <repo>/packages/quay/bin/quay.ts init …`（去掉 shell 的
遗留 `--loop` 拼写——CLI 对 `--loop` 是 fail-closed 的，这正是既有 collision 契约；`--worktree-root`
的派生注入保留，CLI 照样校验根）。

`quay-init-tmux-detection.test.mjs`：4/4 绿。AC1（唯一匹配被检测并写入）、AC2（零匹配 ⇒ exit 0、
`tmux_session: null`、闭集七项齐）、AC3（多匹配 ⇒ null；显式 `--tmux-session` 仍然胜出）、
显式优先于检测。原断言逐字保留：`detected tmux session: <s>` / `no tmux session detected for project '<p>'` /
`multiple tmux sessions match project '<p>'` / `using explicit --tmux-session: <s>` —— CLI 按同字打印。

`quay-init.test.mjs`：18/18 绿（改前 18 个用例全绿；全部保留，无删例）。逐用例：
1. AC1 真实 laydown ⊆ 七项闭集（无扩展/脚本副本）—— 2. config.yml provider 图 + loop 参数
（含 `repo_root`/`test_command`/`tmux_session`/`fork_baseline`，且 native **不含** `path:`/`mcp_entry:`）
—— 3. provider env 四个 `QUAY_NATIVE_*_DIR` 都在项目根内 —— 4. `.claude/settings.json` 启用插件 +
预授权 MCP 命名空间 —— 5. AC4 安装说明全文（github 单参 recipe + 三种 `--scope`，且不出现被拒的两参形
式、不出现"配置即生效"）—— 6. AC3 安装注记（无 `uninstall`、无 AC-161 误述、含 `plugin update` 与
`/quay:init`）—— 7. `--dry-run` 打印闭集且零写入 —— 8. 无 tmux 主机 ⇒ exit 0 + `tmux_session: null`
—— 9. AC3 中途写失败列出 written/unwritten —— 10. AC1 非空目标上的写前失败不把未触及文件报成 written
—— 11. AC2 空目标的负控制（七项全 unwritten）—— 12. AC3 一次运行 ≥3 个可区分状态 —— 13./14./15.
升级路径的遗留 runtime 迁移（bare-PATH / 绝对绑定 / 逐行删除）—— 16. 版本级默认值补齐 + 注释保全 +
幂等 —— 17. 升级 `--dry-run` 报告但不写 —— 18. 不可解析 config：**不**被报成 reconciled，坏字节逐字节
留在 `config.yml.corrupt-<ts>` 且 salvage 被报出（原断言钉的是 shell 的 refusal 语义，AC-330 已把
corrupt 的契约改成「备份 + 重建」，故本条按现契约改写，意图「绝不静默放过」不变）。
为这一组，CLI 的升级路径补了两件事（不是新机制，是把 shell 已有的搬过去）：先跑
`migrateStaleMcpEntry`（删 `path`/`mcp_entry` 两行 + 退役陈旧项目内 runtime，可逆、带备份），再跑
`upgradeConfigContent`；报告用同一套词表（`removed:` / `retired-orphan-runtime:` / `kept-runtime-copy:` /
`reconciled: .quay/config.yml version-level defaults (…)` / `unchanged: … (already current…)`）。

`quay-init-loop.test.mjs`：7/7 绿。AC1 auto-commit（`chore(quay-init):` 前缀 + 只 stage 闭集路径）、
AC2 fresh clone 完整、AC3 非交互 DECLINE 且 `--auto-commit-confirm` 只提交闭集、非 git 工作区 SKIP、
`--dry-run` 不提交、fresh-install config 无维护者注释且值不变 —— 以上经 CLI；AC5（未加引号 heredoc 的
替换惰性）仍扫 `quay-init.sh`，因为该 heredoc 仍是**过渡期**的新装写者（见下方"未做/偏差"）。

`plugin/test/laydown-set-check.test.mjs` 的对照 helper `deriveViaQuayInit`（source 脚本取
`derive_loop_scripts`）改为调 TS 步骤；9/9 绿（改前 develop 8/9，见 ④）。

### ④ AC4：laydown-set-check.sh 不再 source quay-init.sh
改前基线（develop）：
```
$ git show develop:plugin/scripts/laydown-set-check.sh | grep -n "quay-init\.sh"
12: … it CALLS quay-init.sh's            (注释)
82/83/86: …                            (注释)
93:  . "$SELF_DIR/quay-init.sh"          ← 唯一的【代码】命中
# 命中总数 5；排除注释后 = 1
```
改后：
```
$ grep -n "quay-init\.sh" plugin/scripts/laydown-set-check.sh
87:# ⛔ NOT by SOURCING quay-init.sh any more (AC4 of …    ← 注释
# 命中总数 1；排除注释后 = 0
```
接线：第 1 步改为 `node --no-warnings --experimental-strip-types "${SELF_DIR}/quay-init-steps.ts" laydown-set "${ROOT}/plugin"`。
派生集逐字不变：两实现（shell `derive_loop_scripts` vs TS `deriveLoopScripts`）在真实 plugin 树上各
120 名，`sort -u` 后 `diff` 为空（实测）。`never-laydown` 的默认值落在 TS 侧
（`DEFAULT_NEVER_LAYDOWN = "quay-init.sh"`），所以本脚本里连这个名字都不再出现。

测试读数（`node --experimental-strip-types --test plugin/test/laydown-set-check.test.mjs`）：
- 改前（develop，临时 worktree 实测）：`tests 9 / pass 8 / fail 1`（失败的是 AC2 那条断言 helper ==
  `derive_loop_scripts`）。
- 改后：`tests 9 / pass 9 / fail 0`。✅ 不比改前更红。

### ⑤ AC5：被删除的函数 + 消费者检索
可执行层（`plugin/scripts` `packages/*/src` `packages/*/scripts` `plugin/test` `packages/*/test`，
排除 `plugin/vendor/` 与 `dist/`）的命中数，改前(develop) → 改后：

| 函数 | 改前 | 改后 | 消费者结论 |
|---|---|---|---|
| `derive_loop_scripts` (+`_derive_loop_scripts_once`/`mechanism_corpus`/`bare_resolved_scripts`/`consolidated_member_files`/`resolve_tick_core_src`/`NEVER_LAYDOWN`) | 47 | 20 | 唯一活消费者是 laydown-set-check.sh，已改调 TS 步骤；另两个消费者是 `--check-drift`/`--check-dependency-closure` 模式，随本族一起删。改后 20 条全是 TS 移植体的注释/文档 + 测试用例标题，**非注释命中 = 0** |
| `verify_referenced_landed` (+`_reference_set_once`/`_read_references`/`_read_declarations`) | 26 | 12 | 改前就只有注释提及（`quay-init.sh` 段注释 + `l1-delivery-surface-check.ts`/`build-plugin-dist.mjs` 的说明文字）。改后非注释命中 = 0 |
| `compute_drift_report` | 4 | 1 | 唯一调用点在其自身的 `--check-drift` 模式里，一并删除。非注释命中 = 0 |
| `compute_dependency_closure_gaps` | 3 | 1 | 同上（`--check-dependency-closure` 模式）。非注释命中 = 0 |
| `ensure_vendor_runtime` (+`dist_stale`/`vendor_runtime_user_scope_stale_check`) | 5 | 2 | 唯一调用点在 `ensure_target_branch_model`（其头部注释自称"仅开发树需要"）；改为 fail-closed 并在错误里给出 `sync-vendor.sh --sync-dist` 修法。非注释命中 = 0 |
| `--check-drift` / `--check-dependency-closure` 选项 + `DO_CHECK_*` 变量 | — | — | 随其模式删除；现在按未知参数 exit 2（`plugin/skills/init/SKILL.md:200` 早已标注 retired） |
| library-mode guard | — | — | 曾随本族删除，**已恢复**：无 guard 时 source 会真的跑安装流（实测：一个只想取纯函数的测试把工作区铺到了 repo 根）。位置移到 sourcing 调用者能到达的函数之后 |

**保留（有活消费者，故不删）**：`report_closed_set_state` + `_closed_set_fingerprint` +
`_snapshot_closed_set` + `PRE_WRITE_FINGERPRINTS` + EXIT trap —— 消费者是
`plugin/scripts/quay-init-closure-assertion.ts` 的 `runFailureStateReport` → 两个测试文件
（`quay-init-laydown-closure` / `quay-init-closure-ratchet`）。按本 AC 的"确认无活消费者"判据，它们
**有**活消费者 ⇒ 不删。CLI 侧另实现了一份等价报告（`closedSetState`），两个迁移后的测试用它。

副作用登记：`plugin/scripts/quay-init.sh` 2146 → 1309 行；`sh-census-check` PASS
（embeddedInterpreterLines 7331 ≤ 7695）；`quay-init-closure-ratchet --reanchor` 后 3 files / 1022 bytes
不变（shrink-only），baseline 随本次提交更新。

### ⑥ AC6：scoped 门
```
$ bash scripts/test.sh --for-task gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script --allow-thin
ℹ tests 266
ℹ pass 266
ℹ fail 0
```
（merge develop 之后复跑同读数。）

### DoD：真实落地（发布形态产物 + 隔离 HOME）
产物：`bash packages/quay/scripts/build-dist.sh`（esbuild 重打 Core 包）+
`bash plugin/scripts/sync-vendor.sh --sync-dist`，然后把 `plugin/` 整体拷到一个隔离目录当作
"已安装的插件"（`$WORK/installed-quay`），用一个只有 `package.json` 的空 git 仓库 + 隔离 HOME 跑
**安装形态**的 CLI（`$INST/bin/quay` → 该拷贝自己的 `vendor/quay/dist/quay.js`）：
```
$ "$INST/bin/quay" init --root "$SCRATCH" --project p --plugin-root "$INST"
rc=0
$ for f in .quay/config.yml .quay/profiles.yml .claude/launch.settings.json .claude/settings.json .gitignore; do …
OK .quay/config.yml / OK .quay/profiles.yml / OK .claude/launch.settings.json / OK .claude/settings.json / OK .gitignore
OK tasks/ / OK goals/
$ ls -la "$SCRATCH/.quay/plugin"
… .quay/plugin -> /var/tmp/qdod.…/installed-quay
$ "$INST/bin/quay" config validate --root "$SCRATCH"
Config valid.
```
发布门禁断言脚本（同一隔离安装 + 同一空项目）：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/verify-plugin-channel-assertions.ts \
    --installed "$INST" --project "$SCRATCH" --scope user
config-validate-cli PASS — `quay config validate` accepted the init-written config
config-validate-mcp PASS — MCP `config_validate` reported ok:true
project-pointer PASS — .quay/plugin resolves to the verified install (…/installed-quay)
config-native-not-frozen PASS — providers.native omits path/mcp_entry (Core resolves them from the plugin root)
version-consistency FAIL — carriers disagree: VERSION=0.17.0, .claude-plugin/plugin.json=0.17.0-dev, bin/quay --version=0.17.0-dev
shipped-set-clean FAIL — 580 rule-excluded path(s) PRESENT in the installed artifact (fixtures/、*-baseline.json、…)
shipped-shell-reachable FAIL — 113 .sh file(s) in the artifact no runtime surface reaches
scope-install-shape FAIL — the scope's install record points at …/cache/quay/quay/0.16.0, not the verified install
driver-status-readings NOT-EVALUATED — `driver status --json` produced no readable JSON object
serve-own-scope / serve-log-nonempty / server-status-loaded-version NOT-EVALUATED
passed=4 failed=4 not-evaluated=4
```
**init 相关的四条断言全部 PASS**。四条 FAIL 全部是**产物装配/记录形态**，不是 init 的行为：`VERSION`
需要一个真正的 release 戳（本任务的产物是开发树拷贝）、`shipped-set-clean`/`shipped-shell-reachable`
就是 GOAL-029 里"**单独**收窄发布集合"那半个（测试/夹具/baseline/交付验证工具不该随产物发出）、
`scope-install-shape` 要求一条真的 `claude plugin install` 记录（本演练没有做真安装，用的是隔离拷贝）。
如实登记，未用 fixture 冒充。

### 未做 / 与 Proposal 的偏差（如实登记）
1. **`quay-init.sh` 没有缩成纯垫片。** Proposal 说的是"过渡期缩成垫片"，本任务交付的是：CLI 成为
   完整引擎、三个测试族的驱动面全部换成 CLI、脚本的遗留检查族删除。脚本仍保留自己的 `--loop`
   写入路径（含 `detect_test_command`/`detect_tmux_session`/`validate_worktree_root` 各一份）。
   原因：缩小到垫片会波及 **约 20 个不在本任务 Touches 里的测试文件**（install 族、closure 断言库、
   characterization、packaging 等），一次落地把它们的断言全部改写的风险高于本次收益；而 DoD 明确允许
   "init 仍可经脚本垫片**或直接经 CLI** 完成"。⇒ 这仍是过渡态：**检测与写入的实现现在在 TS（CLI），
   shell 留了一份供其自身 `--loop` 路径使用**。这正是 Proposal 所说的"第二个写者"，留待收尾任务消除。
2. `report_closed_set_state` + 闭集指纹**未删除**（有活消费者，见 ⑤）。
3. `plugin/test/quay-init-loop.test.mjs` 的 AC5（heredoc 替换惰性）仍以 shell 的 heredoc 为对象——
   该 heredoc 还在（偏差 1），所以这条仍然是有意义的测量，未改。
4. `quay-init.test.mjs` 的"不可解析 config"一条按 AC-330 已生效的新契约改写（备份 + 重建，而非 refusal）。

### ⑦ 本轮修复（2026-10-07，fan-in suite-red 真因）
上一轮 exit-not-landed 的 `step=suite # fail 72` 不是测试红，是**静态检查**红：
`checker-mutation-check exit=1` 之后 suite 根本没跑（同段读到 `# tests 0 / # pass 0 / # fail 72`，
72 是合成读数）。读到该次 suite 日志
`.quay/fan-in-suite-…~wk-prod-anchor~1791353519224-afcf3f.log` 定位到
`MUTATION-FAIL [baseline GREEN (requested roles are all defined)]: checker exited 3, expected 0`
⇒ 来自 `plugin/scripts/checker-mutation-cases/profiles-role-coverage-check.sh` 的 baseline 臂。

**真因**：`plugin/scripts/profiles-role-coverage-check.ts:185` 用**空临时目录** spawn Core CLI 的
`init --root <ws>`。本任务把 CLI 的新装 `init` 做成与 `quay-init.sh` 的 `detect_test_command` miss
**契约等价**（fail-closed，绝不猜默认值——这也正是本任务 AC3 里「不可检测测试命令」那一档），而空目录
四个 rung（`scripts/test.sh` / `package.json scripts.test` / `go.mod` / `Cargo.toml`）全不命中 ⇒
`init` exit 2 ⇒ checker 拿不到要断言的产物 ⇒ NOT-EVALUATED(exit 3) ⇒ 其 mutation case 的 baseline 臂
（期望 exit 0）判成 ALWAYS-RED ⇒ 整条 `checker-mutation-check --check` 红 ⇒ fail-closed 红掉全量 suite。
（同一日志里 `STATIC_CHECK_NOT_EVALUATED: profiles-role-coverage-check` 是同一根因的另一面。）

**修法（不改任何断言，只补一个与本 checker 的问题【正交】的输入）**：给该 spawn 加
`--test-command`。这条 checker 问的是 profile **承载面**，不是 test-command 阶梯；不补这一项它就会
为一条与断言无关的原因 NOT-EVALUATED。四条断言（A1/A2/A3/R）逐字未动。
按硬规则 5b 全仓检索同类点：`grep -rn '"init"' plugin/ packages/ scripts/` 的非 git 命中**仅此一处**
（其余全是 `git init`）。

**修后读数（worktree 内实测）**：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/profiles-role-coverage-check.ts --check --root <wt>
PASS: init output covers all 5 requested role(s) and matches the shipped carrier; directly-started (no launchArgv call site): manager, outer
exit=0
$ bash plugin/scripts/checker-mutation-cases/profiles-role-coverage-check.sh <workdir>
ok [baseline GREEN (requested roles are all defined)]: exit 0
ok [RED-1 shipped carrier missing a requested role]: exit 1
ok [RED-2 driver requests an undeclared role]: exit 1
ok [RED-3 the two templates disagree]: exit 1
ok [RED-4 retired role (inner) present]: exit 1
ok [NOT-EVALUATED when no init artifact is obtainable]: exit 3
ok [restored baseline GREEN]: exit 0
exit=0
$ node --no-warnings --experimental-strip-types plugin/scripts/checker-mutation-check.ts --check
checkers_total: 88 / checkers_with_mutation: 88 / mutations_that_stayed_green: 0 /
mutations_that_always_red: 0 / uncovered: 0 / errors: 0 / not_evaluated: 0
RESULT: PASS — every registered checker went RED under its injected defect and GREEN on restore.
exit=0
```

`## Touches` 因这次 delta 新增 `plugin/scripts/profiles-role-coverage-check.ts` 而加一行
（`anti-drift-touches-check` 对 Touches 外的 delta 文件是 HARD FAIL，不加会让 fan-in step 3 再红一次）。

### ⑧ 复跑（merge develop 之后，本轮）
- AC-331 判据：`exit=0`。
- AC2 两条取假臂复现：`CAUSE=closed-set-dir-missing-goals`（exit 1）与
  `CAUSE=closed-set-file-missing-.claude/settings.json`（exit 1）；两条改动均用 `cp` 备份还原，
  `git diff` 空（⛔ 不用 `git checkout` 还原，避免误伤同文件其它在飞改动）。
- AC4：`grep -n "quay-init\.sh" plugin/scripts/laydown-set-check.sh` 排除注释后命中 = 0；
  `node --experimental-strip-types --test plugin/test/laydown-set-check.test.mjs` ⇒ `tests 9 / pass 9 / fail 0`。
- AC5：`derive_loop_scripts` / `verify_referenced_landed` / `compute_drift_report` /
  `compute_dependency_closure_gaps` / `ensure_vendor_runtime` 在可执行层（`packages/*/src`、
  `plugin/scripts`、`plugin/test`、`packages/*/test`）的命中**全部是注释/文档**，非注释命中 = 0。
- AC6：scoped 门 `tests 278 / pass 278 / fail 0`，exit 0（本轮读数，含 merge develop 后的树）。

### ⑨ 本轮修复（2026-10-07，fan-in suite-red 真因：5 条，全部是本任务 delta）

上一轮 suite 读数为 `# tests 8841 / # pass 8836 / # fail 5`。5 条逐一定位后**全部**是本任务的
delta（⛔ 不能按 `delta-relatedness = UNRELATED` 的机械提示放过——那 5 个**测试文件**确实不在
Touches 里，但红的是它们**读的**东西）。

**(a) 3 条 ts-typecheck：`init.ts` 的 ok-union 用了 `!` 而非 `=== false`。**
`M63 D1`（`ts-typecheck-gate-config-wiring`）、`M63 C1`（`…-cli-event`）、`M63 A2`（`…-pass`）三条
都报同一句：`packages/quay/src/init.ts(1614,36)/(1615,36): error TS2339: Property 'failure' does not
exist on type '{ ok: true; values: ProjectLoopValues; } | { ok: false; failure: ProjectValueFailure; }'`。
根因：`:1599` 写作 `if (!projectValues.ok)`，随后读 `.failure`；**本仓根 tsconfig 是 `strict: false`**，
在其下 `ok: true | false` 的**否定分支不做窄化**（`branch-model.ts:1147` 早已就地记过这条）。
改成 `if (projectValues.ok === false)`，并把原因就地写成注释。这三条测试是「对本仓真跑
`npx tsc`」，所以任何 .ts 的类型错都会红它们——它们看起来无关，其实是本任务的直接后果。

**(b) 1 条 `packages/quay/test/mcp-server.test.mjs`（AC4 修复面）。**
该用例造一个**裸临时目录**（只有 `.quay/` 或一个坏 `config.yml`），期望 `init` 修好它；本任务把
CLI/MCP 的新装 `init` 做成与 `quay-init.sh` 的 `detect_test_command` miss **契约等价**（fail-closed），
裸目录四个 rung 全不命中 ⇒ `outcome: "project-values-unresolved"`、**什么都不写** ⇒ 用例随后的
`fs.readFileSync(<root>/.quay/config.yml)` ENOENT。修法同 AC3 已迁的那两个夹具
（`init.test.mjs` / `branch-model.test.mjs` 的既有先例）：给该夹具种一个**可检测**形状
（阶梯第一级 `scripts/test.sh`）。该用例问的是 **config 形状**（absent / unparseable），不是
test-command 检测；不种它，断言会因为**另一个**原因红。
按硬规则 5b 全仓检索同类点：`grep -rn '\["init"\|("init"\|'"'"'init'"'"',' --include=*.mjs packages/*/test plugin/test`
的非 `git init` 命中只有本文件、`init.test.mjs`、`branch-model.test.mjs`（后两者已种）、
`plugin/test/init-upgrade-matrix.test.mjs`（其夹具的 config 里**已钉** `loop.test_command: make verify`，
走「既有值优先」档，不经检测 ⇒ 无需种）。

**(c) 1 条 `plugin/test/sh-census-check.test.mjs` AC6（棘轮基线等式）。**
AC6 要求**committed baseline 等于 live 读数**（不是「≥」）。本任务把 `quay-init.sh` 的遗留检查族
（`derive_loop_scripts` / `verify_referenced_landed` / `compute_drift_report` /
`compute_dependency_closure_gaps` / `ensure_vendor_runtime` 及其 `--check-drift` /
`--check-dependency-closure` 模式）与项目值检测整体搬进 TS，两个被普查的 `.sh` 大幅缩短 ⇒
轴从 7695 掉到 **7334**（-361）。上一轮只读了**门**（7331 ≤ 7695 ⇒ PASS），把该文件留在 Touches 外
——门只要求「≤」，AC6 要求「=」，这是**同一条**已经吃掉过邻居的坑（见 baseline 里 entry 21 的
为什么）。已按房规追加 `_reanchorLog` entry 23（from 7695 → to 7334，带逐文件 attribution）。

```
$ node --experimental-strip-types plugin/scripts/sh-census-check.ts --json | jq .totals.embeddedInterpreterLines
7334        # duplicateCopies 0
# residual = 0 的证明：把两个 .sh 都从 develop 取回、其余保持本分支最终树 ⇒ 读数恰为 7695（= develop 基线）
$ git diff --name-status develop HEAD -- '*.sh'
M  plugin/scripts/laydown-set-check.sh     # 183 -> 179 code lines  (-4)
M  plugin/scripts/quay-init.sh             # 1007 -> 650 code lines (-357)
# 两支都仍在轴内（command position 上 exec 解释器：quay-init.sh embedded:[node]；
# laydown-set-check.sh embedded:[node,python3]；都不在例外清单）——动的是行数，不是成员资格
```

**修后复跑（worktree 内，merge develop 之后）**：
```
packages/quay/test/ts-typecheck-gate-{config-wiring,cli-event,pass}.test.mjs   tests 3 / pass 3 / fail 0
packages/quay/test/mcp-server.test.mjs                                         tests 1 / pass 1 / fail 0   (All QN-036 Core MCP server (DIR-007) tests passed.)
plugin/test/sh-census-check.test.mjs                                           tests 20 / pass 20 / fail 0
for d in packages/*/; do npx tsc --noEmit -p "$d"; done                        四处全静默（0 error）
```
硬规则 5b 掃描（Touches 邻域，全部绿）：
```
plugin/test/{quay-init,quay-init-tmux-detection,quay-init-loop,laydown-set-check,
             archive-exclusion-wiring,l1-delivery-surface-check}.test.mjs   tests 50 / pass 50 / fail 0
plugin/test/{quay-init-closure-ratchet,quay-init-laydown-closure,
             init-upgrade-matrix,ratchet-baseline}.test.mjs                 tests 42 / pass 42 / fail 0
packages/quay/test/{init,branch-model}.test.mjs                             tests 127 / pass 127 / fail 0
```

`## Touches` 因本次 delta 新增两行（`packages/quay/test/mcp-server.test.mjs`、`plugin/sh-census-baseline.json`）——
`anti-drift-touches-check` 对 Touches 外的 delta 文件是 HARD FAIL，且 fan-in 的 scoped 门按 Touches 选测，
不加会让这两条修复**不被选中**、下一轮原样再红。

### ⑩ 本轮收尾读数（2026-10-07，修后·merge develop 后·同一棵最终树）

```
$ bash /tmp/ac331-crit.sh                                  # AC-331 判据原文，取自 goal show --json .criterion
exit=0

$ node … quay.ts init --root <裸 mktemp 目录>               # 失败面：真因可读（硬规则 3b），且零写入
quay init: quay init needs the target project's test command but none could be detected in /tmp/quay-bare-….
  Searched: scripts/test.sh → package.json scripts.test → go.mod → Cargo.toml.
  Pass --test-command <cmd> explicitly.
quay-init FAILED — closed-set write state:  unwritten ×7
exit=2   /   find <dir> -type f ⇒ (空)

$ bash scripts/test.sh --for-task gap-init-cli-lays-full-closed-set-… --allow-thin      # AC6 = 本任务 scoped 门
ℹ tests 285 / pass 285 / fail 0 / duration_ms 17960
SCOPED_EXIT=0

$ node plugin/scripts/anti-drift-touches-check.ts --task gap-init-… --worktree <wt> --merge-target develop
ANTI-DRIFT OK: 18 actual file(s), all within declared Touches (19 glob(s))
```

**AC2 两条取假臂在本轮最终树上复现**（改动均用 `cp` 备份 + `md5sum` 校验还原，`git status` 空）：
```
臂 1  删 init.ts:1891 `if (!fs.existsSync(goalsDir)) fs.mkdirSync(goalsDir, …)`
      ⇒ CAUSE=closed-set-dir-missing-goals — the CLI alone must create goals/      exit=1
臂 2  删 init.ts:1908 `writeClaudeSettings(settingsPath, readPluginName(opts.pluginRoot))`
      ⇒ CAUSE=closed-set-file-missing-.claude/settings.json — the CLI alone must
        lay the whole closed set (no shell script needed)                          exit=1
还原后 md5 与备份一致（d4b7b7bf…），两个臂都取自**本轮改过的** init.ts（`ok === false` 那处已在内）。
```

**AC3 的迁移用例集合**（§③ 逐条列出）在本轮最终树上一次全绿：
`plugin/test/{quay-init,quay-init-tmux-detection,quay-init-loop}.test.mjs` 共 29 条（18+4+7）在内，
连同 `laydown-set-check`（9/9）、`archive-exclusion-wiring`、`l1-delivery-surface-check` 合计 50/50。
## Needs-Human

**执行 2026-10-07T07:05:02.754Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：the exited-not-landed failure could not be attributed in 2 consecutive rounds (bounded to at most one retry; no mechanical fan-in result on the outcome ⇒ no suite ran) — infra/contract suspected, not an implementable defect (parser attributed no failing file (failure-line count unavailable on this judgment)); stopping instead of spending another worker session
- 失败步/判词：adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script still present
- run_id：wk-prod-anchor

## Needs-Human

**执行 2026-10-07T08:21:38.786Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 3 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 4 failing lines and attributed none to a file; pseudo-stage tokens: __PERFILE__, lint; unrecognized tokens: ...); stopping instead of spending another worker session
- 失败步/判词：step=suite: __PERFILE__ duration_ms=44672 plugin/test/task-granularity-advice.test.mjs passed=false end_ms=1791361224994 cpu_ms=44154.54 mem_peak_kb=177664
- run_id：wk-prod-anchor
- session_id：0d20c4b1-901e-4a6c-9133-df1495414b49
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script~wk-prod-anchor~1791361109424-cfd830.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script-wk-prod-anchor.log
