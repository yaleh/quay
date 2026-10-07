---
id: gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch
title: quay-init.sh 退化为调用 bin/quay init 的垫片（≤40
  行），skill/README/release.yml/验证脚本改调 CLI，退役 laydown 闭包棘轮
status: ready
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script
goal_ac: AC-332
---
## Proposal
GOAL-029「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」(人 2026-10-07 裁定)。已定决策:终局无 .sh,过渡期把 `quay-init.sh` 缩成调用 `bin/quay init` 的垫片(方向:脚本→CLI,不是 CLI→脚本);不再有 --reconcile/--force。判据权威定义:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-332 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`(退出 0 = 达成)。

现状(已读):调用方有 `plugin/skills/init/SKILL.md`(`bash "${CLAUDE_PLUGIN_ROOT}/scripts/quay-init.sh"`)、`README.md`(手动命令)、`.github/workflows/release.yml`(verify-plugin-channel 两处)、`plugin/scripts/verify-plugin-channel-assertions.ts`(升级演练的重跑 init,约 730 行)、`plugin/scripts/real-target-verify.sh`、`plugin/scripts/verify-deliver-coldstart.sh`、`test/cold-start-e2e.sh`、`test/cold-start-oneliner-e2e.sh`、`packages/quay/src/cli/help.ts` 的 `QUAY_INIT_REL`、`plugin/scripts/config-key-consumer-check.ts` 的 `WRITER_REL`(把脚本登记为配置键"写入者")、`quay-init-closure-assertion.ts`/`quay-init-closure-ratchet.ts`/`docs/analysis/quay-init-closure-ratchet.baseline.json`(laydown 闭包棘轮),另有大量测试 spawn 脚本。`bin/quay` 垫片已负责解析 node(处理 nvm 下 PATH 无 node)。

修法:`plugin/scripts/quay-init.sh` 缩成 ≤40 行垫片,`exec "<插件根>/bin/quay" init "$@"`,并把旧参数映射到新参数面(`--all`/`--loop` 忽略并打印弃用提示,`--plugin-root` 等照传;被删除的 `--force` 给明确报错);skill、README、release.yml、`verify-plugin-channel-assertions.ts`、`real-target-verify.sh`、`test/cold-start*.sh` 逐个改调 `bin/quay init`(注意 skill 所在上下文里插件根来自 `${CLAUDE_PLUGIN_ROOT}`,以及发布门禁里 scratch 项目的 `--test-command` 显式传入);`config-key-consumer-check` 的写入者面改指 `packages/quay/src/init.ts`;`cli/help.ts` 的 `QUAY_INIT_REL` 随之更新或删除;确认没有调用方后退役 laydown 闭包棘轮(`quay-init-closure-ratchet.ts`、`quay-init-closure-assertion.ts`、其基线 json 与 pre-commit 守卫④的接线,同时更新 capability-catalog 声明与 `sh-census` 例外清单);垫片保留一个发布周期后再删(删除不在本任务内)。

## AC
- [x] AC-332 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-332 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。
- [x] 取假:把垫片扩回 >40 行、或让 SKILL.md 再次出现 quay-init.sh 后,判据对应分支变红(附实跑输出)。
- [x] 契约保持:通过垫片运行的既有 `plugin/test/quay-init*.test.mjs` 用例(经 `bash plugin/scripts/quay-init.sh …`)全部仍通过,且 `quay-init.sh --all --loop` 打印弃用提示但行为等价于 `bin/quay init`。
- [x] 全仓检索:`grep -rn "quay-init\.sh" plugin packages/quay/src .github README.md test --include=*.md --include=*.ts --include=*.mjs --include=*.sh --include=*.yml` 排除测试夹具/历史归档/垫片自身后,每一处命中在完成记录里逐条说明(已切换/有意保留及理由),不得有未说明的调用方。
- [x] 棘轮退役:`quay-init-closure-ratchet`/`quay-init-closure-assertion` 的所有接线(pre-commit 守卫④、runner-static-gate、capability-catalog、CI)清理干净,`node --no-warnings --experimental-strip-types plugin/scripts/capability-catalog.ts` 或其 `.sh` 入口无报错;`bash scripts/test.sh --for-task gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:发布门禁 `release.yml` 的 `verify-plugin-channel` 在不再出现 quay-init.sh 的新写法下,用发布形态产物本地演练(`--scope user` 与 `--scope project` 各一次)全部断言通过,升级演练 `--upgrade-from <v0.16.0 重建产物>` 通过;原始输出贴进完成记录(不触发真实 release.yml,不在真实 ~/.claude 上操作)。仅 fixture 绿不算完成。

## Touches
- `plugin/scripts/quay-init.sh`
- `plugin/skills/init/SKILL.md`
- `README.md`
- `.github/workflows/release.yml`
- `plugin/scripts/verify-plugin-channel-assertions.ts`
- `plugin/scripts/real-target-verify.sh`
- `test/cold-start-e2e.sh`
- `test/cold-start-oneliner-e2e.sh`
- `packages/quay/src/cli/help.ts`
- `plugin/scripts/config-key-consumer-check.ts`
- `plugin/scripts/quay-init-closure-assertion.ts`
- `plugin/scripts/quay-init-closure-ratchet.ts`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/sh-census-baseline.json`
- `plugin/test/quay-init.test.mjs`
- `plugin/test/verify-plugin-channel-assertions.test.mjs`
- `plugin/test/quay-init-closure-ratchet.test.mjs`
- `tasks/gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch.md`
- `docs/analysis/suite-perfile-duration-baseline.json`
- `docs/analysis/test-file-baseline.txt`
- `packages/quay/src/cli/init.ts`
- `packages/quay/src/init.ts`
- `packages/quay/test/branch-model.test.mjs`
- `packages/quay/test/init.test.mjs`
- `plugin/scripts/checker-mutation-cases/config-key-consumer-check.sh`
- `plugin/scripts/checker-mutation-cases/quay-init-closure-ratchet.sh`
- `plugin/scripts/packaging-hygiene-check.ts`
- `plugin/scripts/precommit-guard.ts`
- `plugin/scripts/release-cut.mjs`
- `plugin/scripts/release-cut.sh`
- `plugin/scripts/runner-static-gate.ts`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `plugin/test/config-key-consumer-check.test.mjs`
- `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`
- `plugin/test/l1-delivery-surface-check.test.mjs`
- `plugin/test/packaging-hygiene-check.test.mjs`
- `plugin/test/precommit-guard.test.mjs`
- `plugin/test/quay-init-characterization.test.mjs`
- `plugin/test/quay-init-config-env-keys.test.mjs`
- `plugin/test/quay-init-loop.test.mjs`
- `plugin/test/quay-init-stable-plugin-link.test.mjs`
- `plugin/test/release-cut.test.mjs`
## Evidence
（2026-10-07，worker 轮。worktree `/home/yale/work/quay-worktrees/gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch`，分支 `task/gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch`。实现提交 `e0279c77a`，merge develop 后 `8bba0d197`（无冲突）。垫片 38 行。）

### ① AC-332 实跑退出 0
```
$ bash /tmp/qcrit.sh     # 判据原文取自 `quay goal show AC-332 --json` 的 criterion 字段
exit=0
```
（merge develop 之后复跑同读数。）

### ② 取假（两臂，各附原始输出）
臂 1 —— 垫片扩到 43 行（追加 5 行注释）：
```
$ wc -l < plugin/scripts/quay-init.sh
43
$ bash /tmp/qcrit.sh
CAUSE=quay-init-sh-not-a-shim — plugin/scripts/quay-init.sh has 43 lines, a shim must be <= 40
arm1 exit=1
```
臂 2 —— 让 SKILL.md 再次出现 `quay-init.sh`（追加一行注释）：
```
$ bash /tmp/qcrit.sh
CAUSE=caller-still-uses-the-script-plugin/skills/init/SKILL.md — plugin/skills/init/SKILL.md still names quay-init.sh 1 time(s); callers must use bin/quay init
arm2 exit=1
```
两臂均已还原（还原后判据 `exit=0`，`git status --porcelain` 空）。

### ③ 契约保持
```
$ node --test plugin/test/quay-init{,.characterization,.config-env-keys,.install-fixture-wipe,.loop,.stable-plugin-link,.tmux-detection}.test.mjs
ℹ tests 54 / pass 54 / fail 0
```
`--all --loop` 弃用提示（stderr，两行）：
```
quay-init.sh: --all is retired and ignored — `quay init` always lays the same closed set.
quay-init.sh: --loop is retired and ignored — `quay init` always lays the same closed set.
```
行为等价（同一 fixture 各跑一次：垫片 vs `plugin/bin/quay init`，路径归一化后逐文件 diff）：
```
IDENTICAL .quay/config.yml
IDENTICAL .quay/profiles.yml
IDENTICAL .gitignore
IDENTICAL .claude/launch.settings.json
IDENTICAL .claude/settings.json
identical=5 differing=0
```
（对已建项目再跑一次幂等：`auto-commit: skipped as chosen`，无重复写入。）

### ④ 全仓检索（逐条说明）
命令：`grep -rn "quay-init\.sh" plugin packages/quay/src .github README.md test --include=*.md --include=*.ts --include=*.mjs --include=*.sh --include=*.yml`（排除 `plugin/vendor/`）。
- **已切换的调用方 ⇒ 命中 0**：`plugin/skills/init/SKILL.md`、`README.md`、`.github/workflows/release.yml` —— 三者正是判据断言 0 命中的文件；`plugin/scripts/verify-plugin-channel-assertions.ts`、`real-target-verify.sh`、`test/cold-start-e2e.sh`、`test/cold-start-oneliner-e2e.sh`、`packages/quay/src/cli/help.ts`（`QUAY_INIT_REL` → `plugin/bin/quay`，随之删掉已无用的 `QUAY_INIT_BASENAME`/`node:path` import）—— 均改调 `bin/quay init`。
- **有意保留、且是【活代码】的**：`plugin/scripts/verify-deliver-coldstart.sh`（9 命中中的 4 处是码；调用点已改 `"$plugin_root/bin/quay" init …`，`--force` 一并去掉；其余是历史事故记录散文与一处 fake-npm fixture 的占位文件 `: > "$pkg/plugin/scripts/quay-init.sh"`，不是调用）。`plugin/scripts/verify-delivery-surface.ts:71` 把垫片登记进随交付物清单（垫片仍在 ⇒ 成立）。`plugin/test/helpers/quay-init-install-fixture.mjs` spawn 垫片建 fixture（垫片可用 ⇒ 成立，其 7 命中里 5 处是注释）。
- **散文/注释（非调用点）**：`packages/quay/src/init.ts`(14)、`branch-model.ts`(4)、`observation.ts`、`runtime-artifacts.ts`、`worktree-namespace.ts`、`plugin/scripts/{suite-fs-trace,identity-replication-check,suite-bucket-drift-check,profiles-role-coverage-check,quay-init-steps,sync-vendor,laydown-set-check,capability-catalog,start-drivers,probe-routine,threshold-scope-check,tick-core-static-check,spec-declaration-point-check,registry-bare-filename-scan,tmux-isolated,os-anchor-install,os-anchor-watchdog,quay-launch}`、`plugin/loop/*.md`、`plugin/skills/{drivers,cold-start}/SKILL.md`、`.github/workflows/ci.yml:89` —— 全部是说明文字（历史行为/依赖说明），按位置判定不是调用（硬规则 2）。
- **测试夹具/样本串**：`plugin/test/suite-bucket-drift-check.test.mjs`(16)、`gate-scripts-retirement.test.mjs`(5)、`plugin-packaging.test.mjs`(4)、`shipped-shell-reachability.test.mjs`(4)、`architecture-review-cluster.test.mjs`(3)、`identity-replication-check.test.mjs`、`fan-in-workflow-retirement-check.test.mjs` 等 —— 夹具文件名、断言样本行（如 dead_gates_remaining=0 的样本）、commit-subject 样例。`packages/quay/test/gap-git-graph-*.test.mjs` 与 `packages/quay/src/serve-git.ts` 里的命中同样是 subject 样例/注释。
- **保留的机制命名点**：`plugin/scripts/quay-init-closure-assertion.ts`(4) 仍以 `QUAY_INIT_REL = "plugin/scripts/quay-init.sh"` 为唯一命名点，且被 `verify-deliver-coldstart.sh` 的 AC-204 判定 import（见 ⑤ 的退役边界）。
⛔ **没有未说明的调用方**：除垫片自身、上述 dev-only 验证脚本与测试夹具外，没有任何一处仍在执行 `quay-init.sh`。

### ⑤ 棘轮退役（接线清理 + 边界）
- **退役（删除）**：`plugin/scripts/quay-init-closure-ratchet.ts`、`docs/analysis/quay-init-closure-ratchet.baseline.json`、`plugin/scripts/checker-mutation-cases/quay-init-closure-ratchet.sh`、`plugin/test/quay-init-closure-ratchet.test.mjs`。
- **接线清理**：`precommit-guard.ts` 的守卫④整段（import / `ClosureRatchetStatus`+`ClosureRatchetCheckResult` / `stagedLaydownSources` / `runClosureRatchetChecks` / `baselineRelPath` / reason 码 `closure-ratchet-{stale,grown,not-evaluated}` / 结果字段 `closureRatchetCheckOutput` / USAGE 文案 / JSON 键）移除；`runner-static-gate.ts` 的两个 `run_checker`（full 层 `--gate` 与 change 层 `--check-stale`）移除；`release-cut.mjs` 的 `--reanchor` 步骤、`release-cut-bump-ratchet-failed` 与 plan 第 6 步的 re-anchor 子句移除；`develop-deliver-tgz.sh` 的 flat 传输项移除；`capability-catalog-declarations.json` 的 12 条声明移除；`docs/analysis/{test-file-baseline.txt,suite-perfile-duration-baseline.json}` 的条目移除；`plugin/test/precommit-guard.test.mjs` 的 ④ 段（含 `LAYDOWN_SOURCES` import 与 `RATCHET_REL`/`BASELINE_REL`）整段移除；`release-cut.test.mjs` 的 ratchet 载体改写（见下）。
- **边界（Proposal 的前置"确认没有调用方"未满足，故按调用方存在与否分刀）**：`quay-init-closure-assertion.ts` **保留** —— 活调用方 = `plugin/scripts/verify-deliver-coldstart.sh` 的 AC-204 判定，它 `import` 该模块的 `assertClosure`（该脚本注释明写"⛔ 不在此脚本硬编码 FORBIDDEN_PREFIXES，复制一份就是制造漂移，硬规则 4c"）。棘轮退役、断言保留，二者不是同一刀；断言现在检验的是**引擎**铺下的闭集（经垫片 → CLI），对象比退役前更实。`develop-deliver-tgz.sh` 的 flat 传输项与 `n_flat ≥ 9` 下界随之复原。
- 两个 mutation/载体测试的**不变量未丢、载体换掉**：`checker-mutation-cases/config-key-consumer-check.sh` 的 writer 面改成 `packages/quay/src/init.ts`（TS 源扫描：`LOOP_VERSION_DEFAULTS` 表 + 模板的插值行）；`release-cut.test.mjs` 的"子进程自己的话必须进 CAUSE 行"改用 PATH 上的假 `gh` 驱动真实 dispatch 步（棘轮载体已退役，`gh` 是同一路径上另一个纯 PATH 可达的子进程）。
- `node --no-warnings --experimental-strip-types plugin/scripts/capability-catalog.ts`：`summary: 371 scripts | 371 declared | 0 unclassified | 366 ship`（无报错）。
- `bash scripts/test.sh --for-task gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch --allow-thin`：`rc=0`，`ℹ tests 144 / pass 144 / fail 0`（执行了 144 个用例）。

### 顺带修好的漂移（垫片化的必然暴露）
- **`generateLaunchSettingsContent` vs 出厂模板**：内联模板缺 `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` / `CLAUDE_CODE_DISABLE_MOUSE`（出厂 `plugin/.claude/launch.settings.json` 自 2026-08-11 就有），壳的 `write_template` 是逐字拷贝出厂文件 ⇒ 两个写者两个答案（硬规则 5b）。引擎成为唯一写者后补平，并在 `packages/quay/test/init.test.mjs` 加了与 `profiles.yml` 同款的**逐字节不变式**。`quay-init-characterization.test.mjs` 的 fresh 表因此只有 `config.yml` 一行重新锚定，launch 行**不变**（正是那条不变式起作用的证据）。
- **后置检查搬进引擎**：`deliverySurfaceL1Report`（L1 交付面，bare plugin 副本 ⇒ SKIP 行）与 `providerRuntimeExistenceReport`（绑定 runtime 存在性 + 新鲜度，三态）—— 不搬就是静默丢掉两个检查。`l1-delivery-surface-check.test.mjs` 的 AC5 断言随之改指新家。
- **文档分支 bootstrap 回到升级路径**：`runInit` 现在在 upgrade/fresh 分叉**之前**跑 branch-model + 交接 + doc branch（壳 `ensure_target_branch_model` 的原次序）。否则 `/quay:init` 会静默不再建立 `author`，且升级路径不再判定 landing baseline。
- **`config-key-consumer-check` 的写入者面**改指 `packages/quay/src/init.ts`，并补了两处必要的判定：①writer 面本身不参与 consumer 面（否则引擎是 `.ts`、它会"消费"自己写的每个键 ⇒ 恒真枚举，硬规则 4）；②枚举出 0 个键 ⇒ exit 2（读不懂 ≠ 合格，硬规则 3b）—— 这条正是把写入者面改指垫片会踩的坑（实测 0 键 PASS）。
- **fresh install 不再写 `suite_runner`/`scoped_command`/`doc_check_command`**：引擎的版本级默认表只有 `board`/`gates`/`fork_baseline`/`doc_surfaces`；三者本就是可选键，SKILL.md 已改述。quay 自己的 `.quay/config.yml` 是 gitignored 且已带这三键，升级路径逐键保全。

### DoD：发布形态产物本地演练（不触发 release.yml，不在真实 ~/.claude 上操作）
产物：在**一次性 clone** 的 `release/v0.18.0` 分支上跑 `bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify`（no push），`git archive` 取孤儿提交 ⇒ 发布形态树（`bin/quay --version` = `0.18.0`，无 `-dev`）；旧树同法从 tag `v0.16.0` 重建（`0.16.0`）。隔离 HOME + scratch 项目 + `--port 0` 起 serve host（跑完按 pid 停掉并清理）。
**(a) `--scope project`**
```
config-validate-cli PASS — `quay config validate` accepted the init-written config
config-validate-mcp PASS — MCP `config_validate` reported ok:true
version-consistency PASS — all carriers agree on 0.18.0 and none is -dev
shipped-set-clean PASS — no rule-excluded content among 21 rule(s); artifact 264 files / 55625429 bytes / 7298 .sh lines ≤ recorded 264 / 53926575 / 8286
shipped-shell-reachable PASS — all 71 artifact .sh file(s) are reachable from the runtime roots (71 reachable, 166 root file(s) read)
project-pointer PASS — .quay/plugin resolves to the verified install (…/versions/0.18.0)
config-native-not-frozen PASS — providers.native omits path/mcp_entry (Core resolves them from the plugin root)
driver-status-readings PASS — readings present; pointer=current, loaded_version=not-evaluated, path_quay_version=behind
serve-own-scope PASS — serve host runs in its own scope (…/quay-serve-scratch-v-…scope)
serve-log-nonempty PASS — .quay/serve.log carries 418 byte(s)
server-status-loaded-version PASS — running host loaded_version=current
scope-install-shape PASS — install record at scope project resolves to the verified install (…/versions/0.18.0)
passed=12 failed=0 not-evaluated=0     exit=0
```
**(b) `--scope user`**
```
…同上 12 条，逐条 PASS（scope-install-shape 读的是 user 记录）
passed=12 failed=0 not-evaluated=0     exit=0
```
**(c) 升级演练 `--upgrade-from <v0.16.0 重建产物>`**
```
upgrade-link-before PASS — .quay/plugin points at the previous plugin tree (…/old-src)
upgrade-link-after PASS — .quay/plugin now points at the new plugin tree (…/versions/0.18.0)
upgrade-validate-after PASS — `quay config validate` accepted the init-written config
passed=3 failed=0 not-evaluated=0     exit=0
```
（演练器 = `plugin/scripts/verify-plugin-channel-assertions.ts`，即 release.yml 的 `verify-plugin-channel` 所用的同一个；`runUpgradeInit` 已从"跑脚本"改成"跑 `$INSTALLED/bin/quay init`"。）

### 未做/偏差（登记）
- **垫片尚未删除**：Proposal 明写"垫片保留一个发布周期后再删（删除不在本任务内）"。
- **升级演练的起始状态是构造的**：`v0.16.0` 的 init 不写 `.quay/plugin` 链接 ⇒ 用当前引擎 init 后把链接改指旧树，模拟"上一版装的项目"（演练器的 `--upgrade-from` 契约正是这个状态）；旧树本身是真的从 tag 重建的发布形态产物。
- **`verify-deliver-coldstart.sh` 与两个 `test/cold-start*.sh` 未实际执行**（dev-only 手工脚本，需要 npm 全局安装 / 真实冷启动流程）；它们的**调用点**已按新参数面改写并静态核对，其承载的"安装源完整性"等断言属另一个脚本的职责范围。

### 追加（2026-10-07，anti-drift 修正）：`## Touches` 补全为实际改动面
首轮 fan-in 在 anti-drift 步红：`ANTI-DRIFT HARD FAIL — 24 violation(s)`，全部是 `out-of-declared`——本任务的实现面（init 引擎 `packages/quay/src/init.ts`、其 CLI 面与测试、棘轮退役牵动的 `precommit-guard.ts`/`runner-static-gate.ts`/`release-cut.*`/`packaging-hygiene-check.ts`、两份生成基线 `docs/analysis/*`）在立任务时未逐条登记。**宽化 `## Touches` 是正确的修法**（检查器自己的头注释把这一臂称为「declaration was too narrow」），不是回退这些文件：24 个文件全部可追溯到本任务的 Proposal/AC/Evidence（逐条见上），`git log --oneline develop..HEAD -- <file>` 均指向本任务的实现提交 `e0279c77a`。新清单 = 原声明 ∪ `git diff --name-only develop...HEAD` 的 38 个文件。
