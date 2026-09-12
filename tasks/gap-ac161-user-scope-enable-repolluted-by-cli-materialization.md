---
id: gap-ac161-user-scope-enable-repolluted-by-cli-materialization
title: AC-161 回归：用户级 enabledPlugins 被交付安装路径的 CLI materialization 重新写回（AC-162
  只堵了直接写，没堵 shell 出去的那条）
status: done
needs_human_cause: human-adjudication
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-161
---
## Proposal

**问题**：STANDING goal AC-161（GOAL-003，`long-term: true`，status 已 achieved）**再次失败**——被它保证的事实当前不成立。本轮实测复现（跑 `goals/AC-161-user-level-marketplace-only.md` 的 criterion 原文）：

```
CAUSE=user-enabled-plugins — user-level enabledPlugins still enables quay plugin(s): quay@quay
RC=1
```

`~/.claude/settings.json` 现状：`enabledPlugins` 含 `"quay@quay": true`；且 `extraKnownMarketplaces.quay.source.path` 已被改写成 **`/tmp/dir3.npm/lib/node_modules/quay/plugin`**——一个临时 npm 前缀，`/tmp` 被清理后该 marketplace 源即悬空（已无 `env` 键，故 criterion 只走到 enabledPlugins 那条分支）。

**为什么前一次修（done 任务）没守住**：`gap-ac161-user-level-marketplace-only`（done 2026-09-07，commit `df402ac33` 落项目级 `<repo>/.claude/settings.json`）把用户级键删掉、启用迁到项目级；`gap-ac162-register-plugin-no-user-enabled`（done）把 `register-plugin.mjs` **自己写** `enabledPlugins` 的代码删了。**但 AC-162 只堵了「脚本直接写」这一条通道**：`packages/quay/scripts/register-plugin.mjs:148,159` 仍 shell 出去跑 `claude plugin marketplace add` / `claude plugin install quay@quay`，**而 Claude Code 自己的 `plugin install` 会写用户级 `enabledPlugins`**。⇒ 每一次真实的全局安装都会把 AC-161 重新打红：判据守住了写侧脚本，没守住脚本调用的下游。

**回归事件取证（时间戳互校 + 一条能区分的对照，非同形推断）**：
- `~/.claude/settings.json` mtime = `2026-09-11 04:08:38.218764382`
- `~/.claude/plugins/known_marketplaces.json` 的 `quay.lastUpdated` = `2026-09-11T04:08:38.214Z`（**早 4 毫秒**）⇒ `claude plugin marketplace add` 先写 known_marketplaces，CLI 随后在 4ms 后重写了 settings.json
- `/tmp/dir3.npm`（`bin/` + `lib/`）创建于 `Sep 11 04:08` ⇒ 04:08 发生过一次 `npm install -g --prefix /tmp/dir3.npm`
- **能区分两个假设的对照**：该前缀下 `lib/node_modules/quay/scripts/register-plugin.mjs` 经逐行核对**确认已是 AC-162 修复版**（全文仅第 13 行注释提到 `enabledPlugins`，无任何写入语句）——脚本可证不含该写，而用户级键却出现了 ⇒ **写键的不是 quay 的脚本，是它调用的 `claude` CLI**。（若不做这个对照，「脚本又写回去了」与「CLI 写的」两条假设给出相同观测。）

**产生污染的真实调用点**：`plugin/scripts/verify-deliver-coldstart.sh:1079-1114` 的 `step1_install()`，其中 `:1084` `npm install -g --no-audit --no-fund --prefix "$PREFIX" "$QUAY_TGZ" "$QN_TGZ"` **用操作者真实 `$HOME` 跑**，且**不设 `QUAY_SKIP_PLUGIN_CLI`** ⇒ postinstall 走到 `register-plugin.mjs:159` 的 CLI materialization ⇒ 真实 `~/.claude/settings.json` 被写。**同一脚本的 `--selfcheck` 路径（`:2287-2340`）已经**用 fake HOME 隔离、并且**已经有 control 13「enabledPlugins 外溢, AC-161 违反」**（`MP_ENABLED_LEAK`）；**真实安装路径没有这层隔离**——即：反外溢的判据只在夹具里存在，生产走的是污染路径（硬规则 3b / 硬规则 4 推论三 同形：一个只在 fixture 里成立的判据不构成保证）。

**本任务范围（状态迁移 + 堵通道，两条都做）**：AC-162（写侧脚本）与 AC-161（本机状态）是两条独立判据；本任务先**恢复状态**，再堵住「交付/安装路径污染操作者真实 `~/.claude`」这条通道——否则下一次交付验证又会打红，本任务就只是重复 `gap-ac161-user-level-marketplace-only` 已经失败过一次的修法。

<!-- dedup-ref -->
**关联任务（不同机制，仅登记，不构成前置）**：`gap-meta-rungoalround`（status ready）管的是 goal 机械环把 long-term AC 纳入复验域却从不重跑它们（**执行侧**：AC-161 在 `achievedFailing.inScope` 里却不在本轮 `criteria` 里）；本任务管的是 AC-161 的**被保证事实本身再次被破坏**（**状态 + 污染通道**）。两者判据不同、Touches 不相交，互不覆盖。

## Plan

1. **按顺序恢复（反序会把自己锁在门外）**：①确认插件已安装——项目作用域在 `~/.claude/plugins/installed_plugins.json` 已有 `quay@quay` 记录（实测有 `scope: project` @ `/home/yale/work/quay`）→ ②确认项目级 `<repo>/.claude/settings.json` 仍为 `{"enabledPlugins":{"quay@quay":true}}`（盘上已满足，`df402ac33` 已提交进仓库）→ ③**最后**从 `~/.claude/settings.json` 删掉 `enabledPlugins["quay@quay"]`；④把 `extraKnownMarketplaces.quay.source.path` 从 `/tmp/dir3.npm/...` 改回非临时路径（人 2026-09-02 裁定③允许的用户级 marketplace 源是本项目目录，即 `/home/yale/work/quay/plugin`）。跑 AC-161 criterion ⇒ exit 0。
2. **堵通道（机制修复）**：让 `verify-deliver-coldstart.sh` 的安装/交付验证路径对操作者真实 `~/.claude` **零写入**。最小面 = `step1_install()` 的 `npm install -g`（`:1084`）连同延续到 `step1_marketplace` 的 settings 断言（`:1209` `mp_assert_settings "${HOME}/.claude/settings.json"`）一起在**隔离 HOME** 下执行（复用 `--selfcheck` 已有的 fake-HOME 手法 `:2287-2340`），并/或让该路径不触发 CLI materialization（`:598` 已经对 marketplace 分支用了 `QUAY_SKIP_PLUGIN_CLI=1`，`step1_install` 没有）。**要求（判据，不锁实现）**：跑完该路径后，操作者真实 `~/.claude/settings.json` 与跑之前**逐字节相同**（`sha256sum` 前后比对）。
3. **补一条能取假的控制**：新增/扩展一条机械控制，证明「跑该路径 ⇒ 真实 settings 不变」这条断言**能取假**——把该路径换回修复前形态（或让 PATH 上的假 `claude` shim 复刻真 CLI 的 user-scope 写入）时，断言必须转红；换回修复后转绿（`prefix-code-swap-for-red-control` 手法：换回 pre-fix 文件跑新测试，再换回并 diff 验证）。
4. 把 step 1/2/3 的三条读数（criterion exit code、sha256 前后、取假对照的转红读数）写进本任务 AC/结果段。

## AC

- [x] AC1: 跑 `goals/AC-161-user-level-marketplace-only.md` 的 criterion 原文（python3 heredoc，逐字）⇒ **exit 0**（立案当轮实测 exit 1，`CAUSE=user-enabled-plugins — …: quay@quay`）。
- [x] AC2: `extraKnownMarketplaces.quay.source.path` 不再指向临时前缀——`python3 -c "import json,os,sys;d=json.load(open(os.path.expanduser('~/.claude/settings.json')));p=((d.get('extraKnownMarketplaces') or {}).get('quay') or {}).get('source',{}).get('path','');sys.exit(1 if '/tmp/' in p else 0)"` ⇒ exit 0（当前 `/tmp/dir3.npm/lib/node_modules/quay/plugin` ⇒ exit 1）。
- [x] AC3: 交付验证路径对真实 settings 零写入——`b=$(sha256sum ~/.claude/settings.json)`；跑修复后的 `verify-deliver-coldstart.sh` ①安装步（或该脚本的自检入口）；`a=$(sha256sum ~/.claude/settings.json)`；`[ "$b" = "$a" ]` ⇒ exit 0。
- [x] AC4: **取假对照（证明 AC3 不是恒真）**——把该路径换回修复前形态重跑 AC3 的同一条断言 ⇒ **红**（真实 settings 的 sha256 改变）；换回修复后 ⇒ 绿。对照组读数须贴进本任务。
- [x] AC5: 不引入新红——`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` ⇒ exit 0（既有 control 11/12/13 不因本改动转红；该项是本改动的接线负控制，真因见硬规则：「不产生新红」本身不是接线成功的证据，故必须与 AC3/AC4 同读）。
- [x] AC6: fan-in 套件里打红本任务的**另一起因**（非同源）已消除且控制未被削弱——`plugin/test/help-contract-incompatible-behaviors.test.mjs` 的 AC1 `.quay` mtime 负控制不再被 suite-harness 自己的缓存写入打红：`node --test plugin/test/help-contract-incompatible-behaviors.test.mjs` ⇒ **4/4 pass（AC1 绿）**；且该修**能取假**——把新增的 `SUITE_HARNESS_CACHE_FILES` 从 `isNonCheckerRuntimeFile` 谓词移除重跑 ⇒ mtime-race AC3 断言**转红**（actual 恰为 `suite-bucket-effective.jsonl` / `suite-fs-trace.jsonl` 两条），换回 ⇒ 绿。

## 结果（2026-09-11 实测读数）

**① AC1 / AC2（状态恢复）**：criterion 立案当轮 `RC=1`（`CAUSE=user-enabled-plugins — …: quay@quay`）⇒ 恢复后 **exit 0**（`enabledPlugins` 只剩 meta-cc/archguard，用户级无 quay 键）；AC2 **exit 0**，`extraKnownMarketplaces.quay.source.path=/home/yale/work/quay/plugin`。恢复按 Plan 顺序（①②先确认、③最后）：① `installed_plugins.json` 已有 `scope: project` @ `/home/yale/work/quay`；② `<repo>/.claude/settings.json` 已是 `{"enabledPlugins":{"quay@quay":true}}`。
**③/④ 都走机件，不手搓**：④ `claude plugin marketplace add /home/yale/work/quay/plugin` 一次调用同时修正了 `settings.json` 的 `extraKnownMarketplaces` **和** `~/.claude/plugins/known_marketplaces.json`（此前两者都指向 `/tmp/…`；后者是 criterion 看不见、但会让 plugin cache 悬空的另外半边）。**③ 的一个真读数**：`claude plugin disable quay@quay --scope user` **不够**——它把键置成 `false` 而不删键，criterion 的 `any('quay' in k …)` 仍命中 ⇒ 实测 `RC=1`；最终按 Plan ③ 逐字删掉 `enabledPlugins["quay@quay"]` 才翻绿（下次别再试 disable）。
**非 quay 项目对照（AC-161 的 SPEC AC5 语义）**：`cd /tmp/ac161-nonquay && claude plugin list` ⇒ 四条 quay@quay 全部 `✘ disabled`——用户级不再为「本项目之外」启用 quay。

**② AC3（交付验证路径对真实 settings 零写入）**：`BEFORE==AFTER=5e7bc46d1809c77fc5e663730dbae0266c751880865d8ea62743dd41641ce8fb`；脚本自报 `STEP1_HOME_ISOLATED=1`、`STEP1_REAL_SETTINGS_UNCHANGED=1`、`MP_SETTINGS_OK=1`、`MP_ENABLED_LEAK=0`、`AC88_VERIFY=ok`、`SCRIPT_RC=0`；跑完 `known_marketplaces.quay.source.path` 仍是 `/home/yale/work/quay/plugin`（未被动过）。
跑法：`bash plugin/scripts/verify-deliver-coldstart.sh --tgz <staged quay-0.6.1.tgz> --tgz-native <staged> --channel marketplace --root/--prefix/--evidence/--ac89 全指向临时目录`——marketplace 通道 = 段① install + 段①b 注册，正好覆盖本缺陷的两个写入点。

**③ AC4（取假对照）**：同一条断言、同一个产品函数，只把段① 换回修复前形态（scratch 副本逐字只改两处：`STEP1_HOME="$real_home"`（隔离未生效）+ npm 行去掉隔离前缀，即真实 HOME 且不设 `QUAY_SKIP_PLUGIN_CLI`）⇒

```
STEP1_HOME_ISOLATED=0   STEP1_REAL_SETTINGS_UNCHANGED=0
sig: sha256:5e7bc46d1809c77f… -> sha256:6788ddca5764bc58…（段① 内）→ 最终 c953d6bf88d5f515…
MP_SETTINGS_OK=0   MP_ENABLED_LEAK=1
```

真实 `~/.claude/settings.json` 的 sha256 确实改变 ⇒ **红**；换回修复后 ⇒ 绿（上一条）。对照组跑完后再按同样两步恢复状态，AC1/AC2 复验仍 exit 0。

**④ AC5（不引入新红）**：`--selfcheck` ⇒ **exit 0 / `selfcheck: PASS`**；既有 control 11/12/13/14 与其余全部 control 未转红。新增 control 45/46：

```
selfcheck: step1-real-settings-guard(positive) STEP1_HOME_ISOLATED=1 STEP1_REAL_SETTINGS_UNCHANGED=1 isolated_home_written=1 sentinel_sig_same=1
selfcheck: step1-real-settings-guard(falsifiable,pre-fix-semantics) STEP1_HOME_ISOLATED=0 STEP1_REAL_SETTINGS_UNCHANGED=0
```

`isolated_home_written=1` 是特意加的：只测「真实 settings 没变」会被「postinstall 根本没跑」满足 ⇒ 一个恒真的空转，恰是本任务要防的形态（硬规则 4c）；`sentinel_sig_same` 是夹具侧独立第二读数，⛔ 不与产品 guard 共用同一个量。两条都驱动**产品函数 `step1_install` 本体**（⛔ 不是夹具复刻一遍判定逻辑），`plugin/test/verify-deliver-coldstart.test.mjs` 同步钉住这两行。

**⑤ 实现要点与已知残差（硬规则 5b：修好一处 ≠ 只此一处）**：修复 = 段① 两条独立防线——`HOME` 隔离到 `${PREFIX}.home`（**只经显式前缀赋值 + `STEP1_SEGMENT_HOME`，⛔ 不 `export HOME`**：全局改 HOME 会让 `--ac205-session` 段经 `os.homedir()` 去枚举隔离目录的 `~/.claude/sessions`，把「没有同址目标会话」误报成事实）+ `QUAY_SKIP_PLUGIN_CLI=1`。同形调用点全仓枚举（`npm install -g`，`scripts/` 下命中 2 处）：本处（已修）与 `plugin/scripts/develop-deliver-tgz.sh:1369`（远端 heredoc 内、目标是**交付宿主自己的** HOME，属另一条通道、本任务 Touches 未覆盖 ⇒ 未改，如实登记）。**另一条同类上游**：`packages/quay/scripts/register-plugin.mjs:132-166` 的 materialization 跑的 `claude plugin install` 就是「每次真实全局安装都会复红 AC-161」的根；把 materialization 落到哪个 scope 是产品决策（AC-162 只管脚本直接写那条），本任务按 DoD 的「堵 `step1_install` 的真实-HOME 通道」只做交付路径，故在该文件就地留 RESIDUAL 注释（本任务 Touches 已含该文件），⛔ 不静默。

**⑥ AC6（fan-in 套件红的另一起因——与本任务 ①②③④⑤ 无因果，独立处置）**：本轮两次 `exited-not-landed` 的 suite 红是 `step=suite: AssertionError … checkers with a --help side effect (.quay mtime changed)`，唯一 actual = `suite-bucket-effective.jsonl: 1789138022279.2754:59008 -> 1789138026768.6316:59008`（记为 `UNRELATED`，复跑后按「复现即当真」处置）。

**真因（读代码 + 直接复现，非推断）**：`fabe76d82`（2026-09-05，`gap-serial-lowconc-reclassify-post-waterline-cap`）把本测试 `@test-group serial → engine`（并发 1 → 28），其头注释「必须不与其他 writer 竞争共享 worktree」的前提随之失效，而排除集没有跟着补齐——该任务的 AC3「≥20 轮真实生产监控窗口」当时**留空待外部**，本红正是它欠的读数。写入链：并发的/嵌套的 `scripts/test.sh`（cwd = 被测 worktree）→ `run_static_checks` → `runner-static-gate.ts:705` `suite-bucket-drift-check.ts --gate --root <worktree>` → `checkStaticVsTruth()`/`checkTruthSelection()` → `selectBucketsForTouches()` → `writeBucketAttribution()` → 重写 `<worktree>/.quay/suite-bucket-effective.jsonl`。
**两条实测读数**：① 逐 checker 插桩扫（93 个 `-check.ts` 各跑一次 `--help`，每次 spawn 前后读该文件 mtime）**零命中**；唯一 import 该写入函数的 `-check.ts` 在 `--help` 分支先返回 ⇒ **不是 --help 副作用**。② 直接复现该写入：`suite-bucket-select.ts --summary` 前后 **sha256 同为 `bc813d3f…`**（逐字节相同）、mtime `1789138260.918 → 1789138278.110` ⇒ 纯缓存 churn tick。
**处置**：新增 `SUITE_HARNESS_CACHE_FILES = {suite-bucket-effective.jsonl, suite-fs-trace.jsonl}` 并入 `isNonCheckerRuntimeFile`（第 4 类，与 `CAP_OBSERVATION_FILES` 同性质）。**同路径全量枚举（硬规则 5b，5 项逐项贴证据）**：harness 写入被测 worktree `.quay/` 的 = `checker-cost.jsonl` / `full-suite-state.json` / `full-suite.log` / `verification-round.jsonl`（前四条已在既有排除集）+ 本次两条；`node-compile-cache/` 已有目录级排除；`doc-check-cache` / `scoped-gate-cache` / `goal-sufficiency-cache` 在 `scripts/test.sh` 与 `runner-static-gate.ts` 中**零命中** ⇒ 不属该路径，未动。
**控制能取假（AC6 的第二半）**：mtime-race AC3 夹具加进这两个文件后，把 `SUITE_HARNESS_CACHE_FILES` 从谓词移除重跑 ⇒

```
✖ mtime-race AC3 (negative control not degraded): resident-process file exclusion still catches a real side effect
  AssertionError: resident-process tick mtime changes must be excluded
  + [ 'suite-bucket-effective.jsonl: 1789138409322.026:2 -> 1789138409323.0261:4',
  +   'suite-fs-trace.jsonl: 1789138409323.0261:2 -> 1789138409323.0261:4' ]
```

换回修复后 `node --test plugin/test/help-contract-incompatible-behaviors.test.mjs` ⇒ **4/4 pass**（`AC1 … zero .quay mtime change` 20816ms 绿），且「业务文件仍可见」那一半断言未退化。

**⑦ 2026-09-12 续做轮：上次 `exited-not-landed` 的 scoped-gate 红已定位，成因在 develop 侧且已闭合（本分支无需改代码）**

上次判词把失败步记成 `test-isolation-check`——**那是误读**：该检查在同一次输出里是 `PASS: all 24 violation(s) are baselined …`（24 条全在基线内），它本身是绿的。scoped-gate 的 exit 1 来自同一段输出尾部的 `plugin/test/verify-deliver-coldstart.test.mjs` 的 **AC5**：

```
✖ AC5 — every AC-214 NEED ac's write point carries a freshness anchor
  actual: [ 'GOAL-009-AC-239: no record-producing write point found in plugin/scripts/verify-deliver-coldstart.sh' ]
  expected: [],
```

**真因（两点对照，非推断）**：`goals/AC-214-*.md` 的 NEED 里已含 `GOAL-009-AC-239`，而**当时 develop 上还没有该 AC 的写点**——写点由 `5e92c08b4` 引入，`git merge-base --is-ancestor 5e92c08b4 f484d4414` ⇒ **NO**（f484d4414 = 17:38 那次 fan-in merge 的 tip）：

```
f484d4414（17:41 scoped-gate 跑的那个 tip）  script-AC239=0  NEED-AC239=1  ⇒ 复现该断言
baaff8070（本轮 merge develop 之后的 tip）   script-AC239=4  NEED-AC239=1  ⇒ 绿
```

⇒ develop 上存在一段「NEED 先于写点落地」的窗口，随 `5e92c08b4` 进 develop 而闭合。本分支从未改过该脚本的 AC-239 段，⛔ **不要**在分支上补写点（那会把 develop 侧的红搬成我们的红）。

**本轮独立复验（代码改动为空；仅 merge develop + 逐条重跑读数）**：AC1 `RC=0`（用户级 `enabledPlugins` 只剩 meta-cc/archguard，无 quay 键）；AC2 `RC=0`（`quay.source.path=/home/yale/work/quay/plugin`，未被后续任何安装重新污染）；AC3 `BEFORE==AFTER=5e7bc46d1809c77fc5e663730dbae0266c751880865d8ea62743dd41641ce8fb`；AC4 取假对照仍转红（`STEP1_HOME_ISOLATED=0 STEP1_REAL_SETTINGS_UNCHANGED=0` + sentinel 签名改变）；AC5 `--selfcheck` ⇒ exit 0 / `selfcheck: PASS`；AC6 `node --test plugin/test/help-contract-incompatible-behaviors.test.mjs` ⇒ **4/4 pass**；scoped 门 `scripts/test.sh --for-task … --allow-thin` ⇒ **RC=0，26/26 pass**。

## DoD

真实对象被操作过、判据能取假：`~/.claude/settings.json` 被**真实编辑过并回读**——AC-161 criterion 在生产上 exit 0（直接读数，不是断言）；交付/验证路径被**真实跑过一次**而该文件 `sha256sum` 未变（AC3）；**取假对照**在修复前形态下真的转红（AC4）——三条缺一不可。AC-161 由 goal-driver 下一轮复跑后 verdict 由 fail 翻 pass（读 `.quay/goal-round.jsonl` 该 AC 的 verdict / `achievedFailing.inScope` 不再含 AC-161）。⛔ 只改仓库脚本而 `~/.claude/settings.json` 仍含 `quay@quay` ⇒ 判据仍红 ⇒ 不算达成。⛔ 只恢复状态而不堵 `step1_install` 的真实-HOME 通道 ⇒ 下一次交付验证原地复发（`gap-ac161-user-level-marketplace-only` 已经这样失败过一次）⇒ 不算达成。⛔ 反序（先删用户级再确认安装/项目级就绪）会把本机锁在「哪里都没有 quay」——按 Plan 顺序执行。

## Touches

- `plugin/scripts/verify-deliver-coldstart.sh`
- `plugin/test/verify-deliver-coldstart.test.mjs`
- `packages/quay/scripts/register-plugin.mjs`
- `packages/quay/test/npm-pack-e2e.test.mjs`
- `plugin/test/help-contract-incompatible-behaviors.test.mjs`
- `tasks/gap-ac161-user-scope-enable-repolluted-by-cli-materialization.md`

## Needs-Human

**执行 2026-09-11T17:41:52.329Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 成因类：human-adjudication
- 失败步/判词：step=scoped-gate: test-isolation-check — 615 glob file(s), 24 current violation(s) [fixed-path-write=12 shared-build-artifact-write=1 spawns-test-sh=5 process-exit-1=6 mkdtemp-no-cleanup=0 live-data-dir-write=0 shared-root-mkdtemp=0]
  packages/quay-native/test/gate-checked-state.test.mjs:fixed-path-write  (line 26) const tasksDir = path.join(__dirname, ".tmp-gate-checked-state-test");
PASS: all 24 violation(s) are baselined in plugin/test-isolation-violations.txt; the list can only get SHORTER (no additions, no growth, no stale entries).
test-impl-census: checked 615 test files · clean 615 · impl-deleted 0
TOUCHES-DIR-GLOB-HINT: 1 directory-level tasks/*.md glob(s) — enumerate concrete files or add（已知全局锁）(hint only, not a violation)
  + plugin/test/checked-in-write-check.test.mjs
✖ AC5 — every AC-214 NEED ac's write point carries a freshness anchor (mechanical enumeration) (24.850386ms)
ℹ fail 1
✖ failing tests:
✖ AC5 — every AC-214 NEED ac's write point carries a freshness anchor (mechanical enumeration) (24.850386ms)
  AssertionError [ERR_ASSERTION]: every AC-214 NEED ac's write point must carry a top-level build_sha (via ac89_append_goal009 or an explicit field) — otherwise that ac is structurally unsatisfiable in AC-214:
    actual: [ 'GOAL-009-AC-239: no record-producing write point found in plugin/scripts/verify-deliver-coldstart.sh (cannot assert its anchor ⇒ NOT-EVALUATED, not a pass)' ],
    expected: [],
- run_id：wk-prod-1789139008
- session_id：c889c06e-434a-4b62-8329-35b5e258b0a0
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-ac161-user-scope-enable-repolluted-by-cli-materialization-wk-prod-1789139008.log
- ⚠️ 2026-09-12 更正：上条判词里点名的 `test-isolation-check` 是**误读**（它输出的是 `PASS`）；真正的失败是同一段输出尾部的 AC5（AC-239 写点缺失），成因在 develop 侧、已随 `5e92c08b4` 闭合——取证与两点对照见 `## 结果` ⑦。
