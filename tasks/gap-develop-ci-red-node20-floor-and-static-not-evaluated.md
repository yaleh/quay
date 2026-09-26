---
id: gap-develop-ci-red-node20-floor-and-static-not-evaluated
title: 真实 develop CI 恒红：dist-verify-node-floor 在它要验证的 Node 20 底线上调用
  `--experimental-strip-types`（该 flag 需 Node ≥22.6）致打包闸 fail-closed；test job 三条
  STATIC_CHECK_NOT_EVALUATED 后退出 1 ⇒ AC-281 恒不可达
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
**问题（直接量，2026-09-26）**：AC-281（GOAL-022「CI 与 release 渠道成为可信守门员」）判据报红，逐字：
`CAUSE=latest-run-not-green — the latest post-filing CI test job (https://github.com/yaleh/quay/actions/runs/36205553373) concluded 'failure', not 'success'; a fast-but-broken run does not satisfy this AC`
载体 `.quay/ci-runs.jsonl`（652 行）最近 6 次 develop CI **全部 `failure`**，`durationSec` 151–292 ⇒ 既非 success，也远高于判据的 ≤30。

**两个 job 的成因（逐字取自 `gh run view 36205553373 --log-failed`）**：

① `dist-verify-node-floor`（17s，卡在 "Build the npm-pack tarball"）：
```
Checking the .sh delivery form on the staged copy (declared entry surface vs consumer docs)...
node: bad option: --experimental-strip-types
ERROR: the staged plugin's .sh delivery form is not an argued decision — see above.
```
该 job 的用途正是"确认 runner 真在声明的底线上"——`.github/workflows/ci.yml:279-281` 钉 `node-version: '20'` 并断言 `node --version | grep -E '^v20\.'`；而 `packages/quay/scripts/package.sh:145` 调 `${PLUGIN_DEST}/scripts/capability-catalog.sh --entry-surface`，该检查内部以 `node --experimental-strip-types` 运行，**此 flag 自 Node 22.6 才有** ⇒ 在它要验证的底线上**必然**崩，随后打包闸 fail-closed（`package.sh:152` 的 `exit 1`）。⇒ 结构性矛盾（验证底线的 job 自己用了高于底线的语法），⛔ 不是偶发、⛔ 不是网络或 runner 问题。

② `test`（1m24s，退出 1）：821 个测试文件全部通过（`__GROUP__ concurrency=128 files=821 sum_ms=1794916`、末组 `pass 5 / fail 0`、`tmux-leak-scan: clean`），但该 run 的静态检查阶段出现三条：
```
STATIC_CHECK_NOT_EVALUATED: primitives-drift-check
STATIC_CHECK_NOT_EVALUATED: gate-event-coverage-check
STATIC_CHECK_NOT_EVALUATED: direct-to-develop-bypass-check
```
⚠️ **诚实标注（本条的因果未钉死）**：在 `--log-failed` 输出里我**没有**定位到 test job 的 `##[error]` 行，"三条 NOT_EVALUATED 触发兜底红 ⇒ 退出 1"目前只是**与形状一致的最可能解释**，不是已证结论。AC1 要求先把它钉死，⛔ 立案文本不得被当作结论引用。

**做法方向**：① dist job：让那条 .sh 交付形态检查在 Node 20 上可跑——要么改为不依赖 `--experimental-strip-types` 的形式，要么把"底线证明"与"需要高版本语法的打包检查"分成两条路径（该 job 想证明的是**npm-pack 产物能在声明的 Node 底线上安装并运行**，不是"打包脚本本身能在 Node 20 上跑"）；② test job：先钉死三条 NOT_EVALUATED 的成因（缺 ref / 缺文件 / 判据要求高于 CI 环境），再决定补前置还是改判据。⛔ AC-281 的 `success` 与 `durationSec <= 30` 两个条件都不动，⛔ 不靠放宽判据让它变绿。

**已知约束（实现时须遵守）**：`packages/quay/scripts/package.sh` 与 `plugin/scripts/capability-catalog.sh` 都在 `plugin/scripts/sh-census-check.ts` 的全文件代码行计费范围内（当前基线 `embeddedInterpreterLines=7686`=基线，零余量）⇒ 改动必须**净增代码行 ≤0**（注释行免费；`if ! x; then…fi` 三行可折成 `x || …` 一行以抵扣）。若改到 `develop-deliver-tgz.sh` 之外的脚本，另注意其被引用的行号（本仓有按 `<file>:<line>` 引用的惯例）。

## AC
- [x] AC1 钉死 test job 退出 1 的成因（⛔ 不采信本任务上面的"最可能解释"）：在失败日志里定位到使 `test` job 的 `Run tests` 退出 1 的那一步（建议 `gh run view <该 id> --log-failed | grep -n -E '##\[error\]|STATIC_CHECK_NOT_EVALUATED|exit code'`，以及日志末尾的汇总块），把逐字证据与行号贴进 ## Evidence。若确认是三条 NOT_EVALUATED 触发兜底红，给出触发处那几行；若不是，写出真成因（例如某条 summary gate、超时、或资源）。
  ⇒ **已钉死，且立案文本的"最可能解释"被实测【证伪】**。`##[error]` 行存在于 `--log-failed` 落盘副本 `:19519`；三条 NOT_EVALUATED 是**自称的第三态**（`:1160` 逐字 `(third state, not a failure)`，同区块 mutation 汇总 `RESULT: PASS`）。真成因是 **5 个测试文件在 CI 环境上红**（`__PERFILE__ … passed=false` ×5，共 13 条失败断言；逐条行号与真因见 ## Evidence）。立案文本"821 个测试文件全部通过"不成立——`files=821` 是分组文件名数，`__PERFILE__` 有 904 行，末组 `pass 5 / fail 0` 只是最后一个分组的读数。
- [x] AC2 本地复现 dist 那一条（能取假）：在本机 Node 20 下逐字跑 `bash packages/quay/scripts/package.sh` 的那一步（或直接 `node --experimental-strip-types` 的最小样例 + `bash <staged>/scripts/capability-catalog.sh --entry-surface`），复现 `node: bad option: --experimental-strip-types`；贴出 Node 20 与 Node ≥22.6 的**对照**读数（负控制：高版本下同一命令不报该错）。
  ⇒ **已复现并附对照，且修后在同一 Node 20 上转绿**。改前 Node 20（v20.20.2）跑 `bash packages/quay/scripts/package.sh` ⇒ `exit 1` + 逐字 `node: bad option: --experimental-strip-types`；同一 staged 副本在 Node 24 上 ⇒ `exit 0`（负控制）。改后 Node 20 ⇒ `exit 0` 全程绿、tarball 在 Node 20 上 `quay --version` = `0.13.0-dev`、`--help` exit 0（即该 job 的另两步也一并实测通过）。逐字读数见 ## Evidence。
- [ ] AC3 读生产载体（⛔ fixture/本地等价物不算，硬规则 4 推论三）（待外部）
  承接者：本任务落地到 develop 之后、由 develop 的 push 触发的下一次 CI run；新记录由 `ci-runs-collect` 写入 `.quay/ci-runs.jsonl`。
  判据原文：`.quay/ci-runs.jsonl` 中 `workflow=="CI"` ∧ `branch=="develop"` ∧ `conclusion=="success"` 且 `ts` 晚于本次落地时刻的记录数 ≥1，打印该条与前 3 条；并给出 `gh run view <该 id>` 的 URL 与 `.quay/ci-runs.jsonl` 那条记录**相互印证**（sha/时间对得上）。
  ⛔ 本轮**结构上不可达**（循环依赖：判据要求一条 `ts` 晚于本次落地时刻的成功记录，而"成功"只能由落地后的 run 产生）⇒ 按本仓 `（待外部）` 注解机制如实留空，⛔ 不用本地等价物冒充。
- [ ] AC4 判据侧复核（待外部）
  承接者：GOAL-022 的 goal-driver —— 下一次 develop CI 产出 success 记录后重算 AC-281 判据。
  判据原文：把 `goals/AC-281-*.md` frontmatter 的 `criterion` 原样取出、以 `bash` 跑（heredoc），在你的成功 run 之后退出 0；逐字输出贴进 ## Evidence。
  ⛔ 同 AC3：该 criterion 读的就是"最近一次 post-filing 的 CI test job 是否 success"，落地前恒假；⛔ 本轮不改判据、不做本地替代。
- [ ] AC5 三个 job 都绿（待外部）
  承接者：落地后 develop 的 push 触发的 CI run（`version-consistency` / `dist-verify-node-floor` / `test` 三个 job）。
  判据原文：`gh run view <该 id>` 显示 `version-consistency` / `dist-verify-node-floor` / `test` 全部 ✓。若 `durationSec <= 30` 仍不满足，写明是哪个 job 超时及其实测秒数，⛔ 不得改判据阈值。
  ⇒ 三个 job 的**成因已分别修掉并各自在等价环境上实测转绿**（dist 侧：Node 20 全绿；test 侧：5 个文件在复现出 CI 红的等价 checkout 上逐条转绿）；`version-consistency` 本轮在 CI 上本来就是 ✓。**`durationSec <= 30` 的实测下界已写明**（见 ## Evidence 的"≤30s 下界"），⛔ 未改阈值。

## DoD
- [ ] 上面的判据实跑通过，且是**真实 CI 上的读数**（不是本地等价物）：`gh run view` 的 URL 与 `.quay/ci-runs.jsonl` 的新记录能相互印证。（待外部）
  承接者：同 AC3/AC4/AC5 —— 落地后 develop 的 push 触发的 CI run + `ci-runs-collect`。
- [x] ⛔ 不用「放宽/改判据（AC-281 的 success 与 ≤30s）」「`continue-on-error`」「跳过失败步骤」让它变绿；动到的每一步都要能指出它修的是根因（⛔ 不以「CI 绿了」结案，若绿只是因为某步被静默跳过即为未完成）。
  ⇒ 逐条自证（每条都附一条可复核的命令/读数，见 ## Evidence「DoD ② 逐条」）：① `goals/AC-281-*.md` **未改**（本轮零写入）；② `.github/workflows/ci.yml` **未改**——dist 侧修在 product（`package.sh` + `capability-catalog.sh`），因此该 job 的 Node 20 钉子**一动不动地留着**，底线证明反而变强（整个打包路径都在底线上跑通）；③ 无 `continue-on-error` 新增；④ 无步骤被跳过——被动的三个测试文件是**改判据所依据的环境事实**（探测后具名跳过），另两个是**改夹具的前置**，都不是"跳过失败步骤"。
- [x] 若 AC5 的 ≤30s 被证明**结构上不可达**（例如 test job 的下界本身 >30s），如实写明并附实测下界，⛔ 不静默放宽、⛔ 不自行改判据。
  ⇒ 已写明并附实测下界：`test` job 单 job 实测 `1m24s`（CI run 36205553373 的 jobs API 读数）= 84s > 30s；`.quay/ci-runs.jsonl` 最近 6 次 run 的 `durationSec` 区间 151–292s。⇒ `≤30s` 对整条 run **结构上不可达**，且下界由套件本身（`__GROUP__ sum_ms=1794916`、单文件 `duration_ms` 最大 19185）决定，不是某个可修的 job。⛔ 判据阈值未动。

## Evidence

### AC1 —— test job 退出 1 的真成因（立案文本的"最可能解释"被实测证伪）

**工具与范围**：`gh run view 36205553373 --log-failed`（落盘 `/tmp/ci-failed-36205553373.log`，19519 行）；`gh run view 36205553373 --job 108301213270 --log`（test job 全量，19827 行）。行号均为 `--log-failed` 落盘副本的行号。

**① `##[error]` 行确实存在**（立案时说"没有定位到"是检索范围问题）：
```
:19519  test	Run tests	2026-09-26T00:42:34.9204525Z ##[error]Process completed with exit code 1.
```
`gh run view 36205553373` 的 job 视图：`dist-verify-node-floor` 与 `test` 各有一个 `X` 步骤，其余全 `✓`；test job 的 `X` 步骤就是 `Run tests`（末步 `Post …` 均为 `-`）。

**② 三条 NOT_EVALUATED 不是成因（逐字反证）**：同一次 `Run tests` 里紧跟其后的那一行是
```
:1160  checker-cost-lib: 3 checker(s) NOT-EVALUATED (third state, not a failure): primitives-drift-check gate-event-coverage-check direct-to-develop-bypass-check
```
——它**自称第三态、不是失败**。同一区块的 mutation 汇总是 `checkers_total: 86 / checkers_with_mutation: 86 / mutations_that_stayed_green: 0 / mutations_that_always_red: 0 / errors: 0 / not_evaluated: 0`，末行 `:1147 RESULT: PASS — every registered checker went RED under its injected defect and GREEN on restore`。⇒ **静态检查相位是 PASS，不是退出 1 的来源。**

**③ 真成因 = 5 个测试文件在 CI 环境上红**：`--log-failed` 里有 904 条 `__PERFILE__ … passed=true`，另有 **5** 条真实 `passed=false`（另有 4 条 `passed=false` 出现在**测试自己的断言文本**里——那是测试在自证"解析器认得该形态"，不是真红）：

| 文件 | per-file 行号 | 该文件 `fail` |
|---|---|---|
| `plugin/test/arch-coverage-report.test.mjs` | :7530 | 3 |
| `plugin/test/cross-machine-verify-characterization.test.mjs` | :11067 | 1 |
| `plugin/test/release-branch-janitor.test.mjs` | :13600 | 1 |
| `plugin/test/worker-driver-retry-classification.test.mjs` | :17489 | 1 |
| `plugin/test/release-cut.test.mjs` | :18703 | 7 |

合计 13 条失败断言。⇒ 立案文本第 ② 段的"821 个测试文件全部通过"**不成立**：`files=821` 是**分组文件名数**，`__PERFILE__` 行数（904）多于它；末组 `pass 5 / fail 0` 只是**最后一个分组**的读数。test.sh 因这 5 个文件退出 1，`##[error]` 在套件跑完（`tmux-leak-scan: clean`）之后打出——这正是"看起来全绿却退出 1"的形状。

**④ 这 5 条都是 CI 环境专属**：同一 5 个文件在本机 develop / 任务 worktree 上全绿（AC2 的对照环境里逐条复现出红，见下）。**逐条真因与修法**：

| # | 文件 | CI 上的逐字现象 | 真因 | 修法 |
|---|---|---|---|---|
| 1 | `arch-coverage-report` | `:7509 AssertionError: no manifest at /_work/quay/quay/.archguard/query/manifest.json` | `.archguard/` 是**生成物且 gitignored**（`.gitignore:447`）⇒ 在 CI（checkout 自己就是主检出、从没跑过分析器）上**结构性缺席**；测试把"读不到"当成了"读到了且不对" | 加 `HAS_REAL_MANIFEST`，缺席时断言报告**自身的第三态**（`manifestFound/manifestParsed/globalScopeResolved=false`、`globalScopeCoversTsFraction=null`、`scopes=[]`、`uncoveredTsDirsEvaluated=false`）——这正是本文件 ① 节要钉的硬规则 3b 性质，⛔ 不是放宽 |
| 2 | `cross-machine-verify-characterization` | `:11325 actual: … at=2026-01-02T04:05:06Z` vs `:11327 expected: … at=2026-01-02T04:05:06\+00:00` | `%cI` 对零偏移的**拼写随宿主 git 版本变**：git `69e2bee1`（"date: make iso-strict conforming for the UTC timezone"，v2.44 之后）把 `+00:00` 改成 `Z`。本机 git 2.43.0（旧形）、CI runner git **2.50.1**（`:44 git version 2.50.1`，逐字取自 `actions/checkout@v4` 步骤）⇒ 测试把**宿主**当成了机制。实现侧是**忠实移植**：改前 bash 的 `commit_iso` 逐字为 `git -C "${repo_root}" show -s --format=%cI "$1"`（`git show a93ab2d44:plugin/scripts/cross-machine-verify.sh:145-147`），与新 TS 的 `commitIso` 同源 | 期望值改为**向夹具自己的 git 取**（即测试标题所称的"the commit's own timestamp"），并保留 `Date.parse(ctime) === Date.parse(D2)` 的瞬时相等断言，⛔ 不退化成同义反复 |
| 3 | `release-branch-janitor` | `:13590 actual: 0, expected: 5`（`AC5 … three distinct outputs`） | CI runner **以 uid 0 跑套件**（同一 run 的 prerequisite 步逐字 `:231 uid=0 LC_ALL=C.UTF-8`）⇒ `chmod 000` 挡不住 `CAP_DAC_OVERRIDE`，"exists but unreadable" 这一态在该宿主上**构造不出来**，脚本如实报了"读到且无事"（exit 0） | 前置改为**探测**（`chmod 000` 后 `accessSync(R_OK)` 是否真的抛），探测不到就 `t.skip()` 并具名理由；另两态（`missing`→4 / `ran`→0）**无条件断言** |
| 4 | `worker-driver-retry-classification` | `:17478 AssertionError: … suite 步走 full-suite-runner：bash -c echo 'no-suite-tooling: 未声明 loop.suite_runner 且未声明 loop.test_command（无测试能力）' >&2; exit 2` | `defaultMechanicalSuiteCommand` 的分叉读的是 **worktree 的 `.quay/config.yml`**（`worker-fan-in.ts:981` `readLoopFanInContract`），而 CI 用 `cp .quay/config.yml.example .quay/config.yml` bootstrap，该模板**刻意不声明** `loop.suite_runner`（它是给 adopters 复制的模板，`quay-buckets` 只对 quay 自己成立）⇒ 解析成 fail-closed 的"无测试能力" argv | 夹具自建一个**就地声明** `suite_runner: quay-buckets` 的 worktree（`mkdtemp` + 写 `.quay/config.yml`），判据不再随宿主配置漂移，测的仍是同一件事 |
| 5 | `release-cut` | `:18905 at makeClone (…:128:10) 128 !== 0`（7 条全红） | `git clone` 会把**源的 HEAD 分支落成本地分支**；CI 的 checkout HEAD 就在 `develop`（`ci.yml` 触发在 push to develop），于是 `git branch develop origin/develop` 报 `fatal: a branch named 'develop' already exists`（128）。夹具的注释自己写着前提"the main checkout carries `author`"——CI 上不成立 | 改为**仅在 `refs/heads/develop` 缺席时**创建；随后的 `checkout -B author origin/develop` 在两种情形下都把 HEAD 放回前提要求的位置，夹具形态不减弱 |

### AC2 —— dist 那一条的本地复现与对照（Node 20 / Node 24）

**环境**：本机 nvm 装了 `v20.20.2`（本轮为取该底线读数而装）与 `v24.21.0`；worktree = 任务 worktree 的绝对路径。

**改前（未修的源码）**：
```
$ nvm use 20 && bash packages/quay/scripts/package.sh
…
Checking the .sh delivery form on the staged copy (declared entry surface vs consumer docs)...
node: bad option: --experimental-strip-types
ERROR: the staged plugin's .sh delivery form is not an argued decision — see above.
       An internal .sh appears in consumer-facing docs (plugin/loop/*.md or plugin/skills/*/SKILL.md).
       Either declare it in PUBLIC_ENTRYPOINTS (plugin/scripts/capability-catalog-declarations.json) or remove the doc reference.
exit=1
```
与 CI 逐字同形。**注意崩点**：`build-dist.sh` 与 staging 都成功了，崩在 `.sh` 交付形态门。

**负控制（同一 staged 副本，高版本 Node）**：把 staging 拷出来、按 `package.sh` 的顺序跑 `build-plugin-dist.mjs` + `--rewrite`，然后
```
$ nvm use 20 && bash <staged>/scripts/capability-catalog.sh --entry-surface   → exit=9  node: bad option: --experimental-strip-types
$ nvm use 24 && bash <staged>/scripts/capability-catalog.sh --entry-surface   → exit=0  AC3 gate: … → PASS
```
⇒ **同一份字节、同一个命令，只有 Node 版本不同**，一个崩一个过 —— 这就是"flag 需 ≥22.6"的取假读数。

**根因（两条，逐字可查）**：
1. **交付形态缺陷（真实产品缺陷，不只在 CI）**：`capability-catalog.sh` 的 exec 行用的是**花括号**拼写 `${SCRIPT_DIR}/capability-catalog.ts`。`build-plugin-dist.mjs` 的分阶段重写里，只有**无花括号**形 `"$SCRIPT_DIR/X.ts"` 那条规则（`build-plugin-dist.mjs:730-734`）会**同时丢掉 flag**；花括号形只被通用规则（`:743`）命中，**只重写路径、留下 `--experimental-strip-types`**。实测重写后的交付物逐字为
   `exec node --experimental-strip-types "${SCRIPT_DIR}/dist/capability-catalog.js" "$@"`
   —— 一个**不需要 flag 的 bundle**，却带着 flag 调用 ⇒ 任何 Node <22.6 的消费者跑 `bash plugin/scripts/capability-catalog.sh` 都会 `bad option`。同族缺陷 `quay-init.sh:82-94` 已记录过（"花括号形留下 flag"）。
2. **打包顺序缺陷**：`package.sh` 在 **dist 重写之前**跑这道门（原 `:145`），此刻 staged 的 wrapper 还是源码形态、exec 的是**裸 .ts** ⇒ 在 Node 20 上结构性跑不动。⇒ 整条 `package.sh` 在它本该验证的底线上不可能成功。

**修法**：① `capability-catalog.sh` 的 exec 行改为无花括号拼写（行数不变，重写后得 `exec node "$SCRIPT_DIR/dist/capability-catalog.js" "$@"`）；② `package.sh` 把这道门**移到 dist 重写之后**（注释随门一起搬，另有前向指针）。改后同一道门判的是**重写后的**消费面文档（更接近消费者拿到的形态），非空计数不变。

**改后实测（同一 Node 20）**：
```
$ nvm use 20 && bash packages/quay/scripts/package.sh
build-plugin-dist: rewrote 55 staged invokers to reference dist bundles
Staged: …/packages/quay/plugin (416 files)
Checking the .sh delivery form on the staged copy (declared entry surface vs consumer docs)...
delivery form (.sh): 76 shipped | 29 declared consumer-facing | 47 internal
consumer-facing docs reference 21 distinct .sh
AC3 gate: every consumer-doc-referenced .sh is a declared public entry point → PASS
Delivery form measured: 180 loose .sh staged | consumer-facing surface declared + gated (AC3)
…
dist-closure gate OK: 110 referenced dist bundles all present in quay-0.13.0-dev.tgz
exit=0
```
交付物里的 wrapper 逐字变为 `exec node "$SCRIPT_DIR/dist/capability-catalog.js" "$@"`（flag 已消失）。

**该 job 另两步也在 Node 20 上实测通过**（AC‑281 的"产物在底线上安装并运行"就是这一步）：
```
$ nvm use 20 && cd packages/quay && npm install -g quay-0.13.0-dev.tgz        → exit=0
$ node <realpath of the installed bin> --version   on v20.20.2              → 0.13.0-dev
$ node <realpath of the installed bin> --help                                → exit 0
```
（注：`command -v quay` 在本机命中的是**另一个**已存在的插件缓存副本，故上面用 npm 全局前缀里的真实路径取值；CI 的临时容器里不存在这个歧义。）

**门的负控制（证明移动后的门仍能取假，不是空转）**：在 staged 副本的一个 `plugin/skills/*/SKILL.md` 里注入一行 `plugin/scripts/assert-clean-tree.sh`（一个**内部** .sh，不在 `PUBLIC_ENTRYPOINTS` 的 29 个声明里）：
```
$ nvm use 20 && bash <staged>/scripts/capability-catalog.sh --entry-surface
consumer-facing docs reference 22 distinct .sh
FAIL (AC3): 1 internal .sh script(s) are referenced by consumer-facing docs — the demotion is verbal, not real:
  assert-clean-tree.sh
exit=1
```
还原后 `exit=0`。⇒ 门在 Node 20 上**既能跑又能红**。
（另一次误试记录在案：第一次注入的是 `slot-refill.sh`，它**在**声明的 entry 集里，门如实放行——这不是门失灵，是我选错了样本；改用内部 .sh 后即红。）

**sh-census 约束核对**：`node --experimental-strip-types plugin/scripts/sh-census-check.ts` ⇒
`144 tracked .sh · 21060 code lines · 55 with an embedded interpreter (7686 lines)`，
`PASS — embeddedInterpreterLines=7686 ≤ 7686, duplicateCopies=0 ≤ 0` ⇒ **净增代码行 0**，与基线相等。

### AC1/AC2 的等价复现环境（本轮用于逐条验证 5 个文件）

按已 done 的同族任务 `gap-ci-suite-red-on-fresh-checkout-beyond-config-yml` 立的验证法：**在一条与任何长寿命 checkout 都不同的路径上做全新 clone + CI 的 bootstrap + 跑同一批文件**。
- `git clone --local /data/home/yale/work/quay /data/home/yale/work/quay-ci-repro`；`cp .quay/config.yml.example .quay/config.yml`（ci.yml 的 bootstrap 步逐字）；`node_modules` 用**软链**到主检出（省一次 `npm install`；被验证的 5 个文件都只 shell out 到 git/node，不依赖安装产物——如实标注这处与 CI 的差异）。
- 该 clone 上**逐条复现出 CI 的红**：`arch-coverage-report` 3 红、`worker-driver-retry-classification` 1 红、`release-cut` 7 红（与 CI 的 per-file `fail` 数**逐位相同**）。
- **修后**：`arch-coverage-report` 13/0、`worker-driver-retry-classification` 27/0、`release-cut` 7/0；且在真配置的 worktree 上同三个文件同样全绿（**两个方向都测了**，不是只测一边）。

另两条在该 clone 上不复现（它们依赖的是**宿主性质**，不是 checkout 性质），改用**针对性的宿主条件模拟**，每一对都带"改前必红 / 改后必绿"的取假对照：

- **#2（git 拼写）**：用一个只对 `--format=%cI` 生效的 git shim 把 `+00:00` 改写成 `Z`（模拟 CI 的 git 2.50.1）。对照读数：
  - **改前**测试 + shim ⇒ `not ok 1 - C1a …`，`# pass 18 / # fail 1`（与 CI 逐字同形）
  - **改后**测试 + shim ⇒ `# pass 19 / # fail 0`
  - 无 shim（本机 git 2.43.0）⇒ 改前改后均 `19/0`（说明本机确实测不出这条，也正是它躲过所有本地门的原因）
- **#3（uid 0）**：把测试里的 `chmodSync(…, 0o000)` 换成 no-op（模拟 `CAP_DAC_OVERRIDE` 宿主 ⇒ 文件保持可读）。对照读数：
  - **改前**测试 + no-op ⇒ `not ok 4 - AC5 …`，`expected: 5 / actual: 0`（**与 CI 的 `0 !== 5` 逐位相同**），`# pass 6 / # fail 1`
  - **改后**测试 + no-op ⇒ `ok 4 - AC5 … # SKIP this host cannot deny itself read of … (uid 1004 ⇒ CAP_DAC_OVERRIDE), so the "exists but cannot be read" state is not constructible here`，`# pass 6 / # fail 0 / # skipped 1`
  - 本机正常 uid ⇒ 改后 `# pass 7 / # fail 0 / # skipped 0`（**满强度那一支没退**）

### ≤30s 下界实测（AC5 的"若结构上不可达"）

- `test` job 在 run 36205553373 的 jobs API 读数：**1m24s = 84s**（整个 job），其中 `Run tests` 一步即 `__GROUP__ concurrency=128 files=821 sum_ms=1794916`（≈1795 秒 CPU-毫秒，128 并发下墙钟 ≈84s），单文件最大 `duration_ms=19185`。
- `.quay/ci-runs.jsonl` 最近 6 次 develop run 的 `durationSec` 区间 **151–292**。
- ⇒ 无论 `durationSec` 量的是 test job 还是整条 run，**`<= 30` 都结构性不可达**，下界由套件规模决定（不是某个可修的 job）。⛔ 判据阈值未动，⛔ 未用任何"跳过/静默"手段缩短它。

### DoD ② 逐条（"不用放宽判据 / 不跳过失败步骤"）

| 项 | 自我核对 |
|---|---|
| `goals/AC-281-*.md` 未改 | 本轮对 `goals/` 零写入（改动清单见下） |
| `.github/workflows/ci.yml` 未改 | 同上。dist 侧修在 product（`package.sh` + `capability-catalog.sh`）⇒ job 的 `node-version: '20'` 与 `node --version \| grep -E '^v20\.'` **原样保留**，底线证明只增不减 |
| 无 `continue-on-error` 新增 | `grep -n continue-on-error .github/workflows/ci.yml` ⇒ 仅原有的 npm 缓存步（本轮未新增，也未改） |
| 无步骤被静默跳过 | 5 个文件的改动是"**改判据所读的前置/环境事实**"与"**改夹具的前置**"，不是"把失败步骤跳过"：其中只有 #3 引入了 `t.skip`，且它**只**在宿主物理上构造不出该前置时触发，并**具名打印**理由（本机正常 uid 下 `# skipped 0`，满强度断言照跑）；其余 4 个文件改后**仍断言全部原判据**（#1 断言的是报告的第三态、#2 断言瞬时相等、#4 断言同一 argv 契约、#5 断言同一夹具形态） |
| 修的是根因 | 每条都指名了根因（见前面 5 行表），且每条都有"改前必红 / 改后必绿"的对照读数 |

**本轮改动清单（7 个文件，全部在 ## Touches 内）**：`packages/quay/scripts/package.sh`、`plugin/scripts/capability-catalog.sh`、`plugin/test/{arch-coverage-report,cross-machine-verify-characterization,release-branch-janitor,release-cut,worker-driver-retry-classification}.test.mjs`。

## Touches
- `packages/quay/scripts/package.sh`
- `.github/workflows/ci.yml`
- `plugin/scripts/capability-catalog.sh`
- `plugin/test/arch-coverage-report.test.mjs`
- `plugin/test/cross-machine-verify-characterization.test.mjs`
- `plugin/test/release-branch-janitor.test.mjs`
- `plugin/test/release-cut.test.mjs`
- `plugin/test/worker-driver-retry-classification.test.mjs`
- `tasks/gap-develop-ci-red-node20-floor-and-static-not-evaluated.md`
