---
id: gap-ac161-postinstall-rematerializes-user-scope-enable
title: AC-161 第三次回归：`npm install -g` 的 postinstall materialization 仍默认以 user
  scope 启用插件——上一次的修法把它登记为「产品决策」留作残差，于是每次真实安装都重新打红
status: ready
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

**问题**：STANDING goal AC-161（GOAL-003，`long-term: true`，status 已 achieved）**第三次失败**——被它保证的事实当前不成立。立案当轮逐字跑 `goals/AC-161-user-level-marketplace-only.md` 的 criterion：

```
CAUSE=user-enabled-plugins — user-level enabledPlugins still enables quay plugin(s): quay@quay
exit=1
```

`~/.claude/settings.json` 现状：`enabledPlugins` 含 `"quay@quay": true`（另两条 meta-cc/archguard 无辜）；`extraKnownMarketplaces.quay.source.path` = `/tmp/quay-install-PREFIX-20260914-214317/lib/node_modules/quay/plugin`（临时 npm 前缀，`/tmp` 清理后即悬空）；无 `env` 键（故 criterion 只走到 enabledPlugins 那条分支）。

**回归时间线（四条独立读数互校，非同形推断）**：

| 时刻 (UTC) | 读数 | 载体 |
|---|---|---|
| 21:34:14.898 / 21:37:00.816 / 21:39:50.918 | AC-161 verdict=**pass**（round 22 / 23 / 24） | `.quay/goal-round.jsonl` 的 `criteria` 条目 |
| 21:41:08 与 21:43:17 | 两次真实 `npm install -g --prefix /tmp/quay-install-…` | `~/.npm/_logs/2026-09-14T21_41_08_338Z-debug-0.log` / `…T21_43_17_436Z-debug-0.log`，分别对应前缀 `/tmp/quay-install-A-20260914-214108` 与 `/tmp/quay-install-PREFIX-20260914-214317` |
| 21:41:16.003 | `installed_plugins.json` 新增一条 `quay@quay` `scope:"user"` / `version:"0.7.0"` / `installPath=~/.claude/plugins/cache/quay/quay/0.7.0` | 直接读盘 |
| 21:43:24.063 / 21:43:24.067 | `known_marketplaces.json` 的 `quay.lastUpdated` 与 `~/.claude/settings.json` 的 mtime **相差 4 毫秒** | `stat` 两文件 |

**能区分两个假设的对照**：`settings.json` 里那条 marketplace 路径**逐字等于**那个临时前缀，且四条写盘时刻相隔 <1s ⇒ 污染来自 **postinstall → `register-plugin.mjs` → `claude plugin marketplace add` + `claude plugin install quay@quay`** 这条链，而不是某次手工 `claude plugin install`。**若污染来自手工调用，`settings.json` 里不会出现这个只存在于该次安装期的临时前缀路径。** 两次安装都用了**操作者的真实 `HOME`**（脚本自己的 `QUAY_SKIP_PLUGIN_REGISTER`/`QUAY_SKIP_PLUGIN_CLI` 都没设）。

**为什么前两次修都没守住（硬规则 5b：修好一处 ≠ 只此一处）**：

1. `gap-ac161-user-level-marketplace-only`（done 09-07，`df402ac33`）：**只恢复状态**（删用户级键 + 启用迁项目级），没碰任何写侧通道。
2. `gap-ac162-register-plugin-no-user-enabled`（done）：**只堵了脚本自己那一笔** `enabledPlugins` 写入；脚本随后 **shell 出去**跑 `claude plugin install`（`packages/quay/scripts/register-plugin.mjs:161-183`），而 **Claude Code CLI 自己的 `plugin install` 默认 `--scope user`** ⇒ 写键的是被调用者，不是脚本。
3. `gap-ac161-user-scope-enable-repolluted-by-cli-materialization`（done 09-11/12）：堵了**一条**交付路径（`verify-deliver-coldstart.sh` 段①的 HOME 隔离 + `QUAY_SKIP_PLUGIN_CLI=1`），并**明确把本文件（`register-plugin.mjs`）的 materialization 登记为「RESIDUAL，已知且故意不修」，理由是「落到哪个 scope 是产品决策」**——该注释今天仍在 `:132-147`。⇒ **根从未被触碰**，被堵的只是「已知的两条路径之一」；**任何**真实全局安装（含在飞任务的真机验证）照样经由 postinstall 打红。
   **⇒ 第三次不是运气差：第一次修就写明了会复发。**（硬规则 12 的同形：用一条未决的「产品决策」长期充当阻塞位，代价是判据每轮被真实生产打红。）

**为什么仓库里那条「不会写用户级 enabledPlugins」的断言没拦住（硬规则 4 推论三：只能被 fixture 满足的判据不是测量）**：`packages/quay/test/npm-pack-e2e.test.mjs:225` 逐字断言 `settings.enabledPlugins?.["quay@quay"] === undefined`，**且它现在是绿的**——因为该测试传 `QUAY_SKIP_PLUGIN_CLI: "1"`（`:213-217`），**恰好关掉了那条会违反它的步骤**（注释自陈「the claude-CLI materialization path is proven separately in the task's manual AC evidence」）。⇒ 断言与它所守的通道**永不同时在场**：绿的是夹具，红的是生产。

**本任务范围（状态恢复 + 堵根通道 + 修那条空转的判据，三件都做，缺一不算达成）**。

<!-- dedup-ref -->
**关联在飞任务（机制不同，登记不构成前置）**：`gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved`（status ready）的 `## Touches` 也含 `packages/quay/scripts/register-plugin.mjs`，且它要在 orangevps 上做 user scope 安装。本任务**不得**把「user scope 启用」这个能力删掉——只把**默认**从 user 改成项目级/不启用，并保留一个**显式** opt-in，使 AC-258 那类刻意的 user-scope 安装仍可达成。（Touches 在同一文件上重叠，由派发器的锁串行化，不是判据冲突。）

## Plan

1. **按顺序恢复状态**（反序 = 把自己锁在门外；⛔ **不要**用 `claude plugin disable`——它把键置 `false` 而不删键，criterion 的 `any('quay' in k …)` 仍命中，09-11 已实测 `RC=1`）：① 确认项目级 `<repo>/.claude/settings.json` 已是 `{"enabledPlugins":{"quay@quay":true}}`（盘上已满足，逐字读回）；② 确认 `installed_plugins.json` 里本仓库那条 `scope:"project"` 记录还在（09-08 起在）；③ **最后**从 `~/.claude/settings.json` 删掉 `enabledPlugins["quay@quay"]`；④ 把用户级 marketplace 源改回本项目目录：`claude plugin marketplace add /home/yale/work/quay/plugin`（一次调用同时修 `settings.json` 的 `extraKnownMarketplaces` **和** `~/.claude/plugins/known_marketplaces.json` 的 `quay.installLocation`——后者是 criterion 看不见、但会让 plugin cache 悬空的另外半边）。跑 criterion ⇒ exit 0。
2. **堵根通道**：让 `register-plugin.mjs` 的 materialization **默认不再写用户级启用**——与它自己文件头声明的契约逐字一致（`:12-13`「It does NOT write a user-level enabledPlugins entry — enabling is left to the target project's `<repo>/.claude/settings.json` (AC-161)」）。**要求（判据，不锁实现）**：真实全局安装（`npm install -g --prefix <临时前缀> <tgz>`，**操作者真实 `HOME`**、⛔ 不设 `QUAY_SKIP_PLUGIN_REGISTER` / `QUAY_SKIP_PLUGIN_CLI`、⛔ 不做 HOME 隔离）跑完后，AC-161 criterion 仍 **exit 0**。（交付/验证路径的 HOME 隔离是**上一层**的补丁，不能替代这一层——它的教训正是「隔离了它知道的那条路径，漏了它不知道的那条」。）
3. **保留能力**：user-scope 启用改为**显式 opt-in**（env var，形如 `QUAY_PLUGIN_SCOPE=user`；⛔ 默认绝不 user），使 AC-258 的刻意 user-scope 安装仍可达成；该 opt-in 必须在 `README.md` 的环境变量表里有行（与既有 `QUAY_SKIP_PLUGIN_REGISTER`/`QUAY_SKIP_PLUGIN_CLI` 同表，`:759-760`）。
4. **修那条空转的判据**：`npm-pack-e2e.test.mjs:225` 的断言必须进入**能违反它**的那条路径——新增控制：把 materialization 步**打开**（去掉 `QUAY_SKIP_PLUGIN_CLI`，用一个假 `claude` shim 复刻真 CLI 的 user-scope 写入，或直接驱动真实分支）⇒ 断言**转红**；关闭 ⇒ 绿（`prefix-code-swap-for-red-control` 手法）。
5. 把 1–4 的读数（criterion exit code、真实安装前后 `settings.json` 的 sha256、取假对照的转红读数、opt-in 的正控制）写进本任务 AC/结果段。

## AC

- [ ] AC1: 逐字跑 `goals/AC-161-user-level-marketplace-only.md` 的 criterion（python3 heredoc 原文）⇒ **exit 0**（立案当轮实测 exit 1，`CAUSE=user-enabled-plugins — …: quay@quay`）。
- [ ] AC2: 用户级 marketplace 源不再指向临时前缀——`python3 -c "import json,os,sys;d=json.load(open(os.path.expanduser('~/.claude/settings.json')));p=((d.get('extraKnownMarketplaces') or {}).get('quay') or {}).get('source',{}).get('path','');sys.exit(1 if '/tmp/' in p else 0)"` ⇒ exit 0；同一条断言对 `~/.claude/plugins/known_marketplaces.json` 的 `quay.installLocation` 也 ⇒ exit 0（立案当轮两者都指向 `/tmp/quay-install-PREFIX-20260914-214317/…` ⇒ exit 1）。
- [ ] AC3（**读生产载体，不是夹具**）：把**真实产物 tarball**（`plugin/scripts/develop-deliver-tgz.sh` / `package.sh` 产出的 `quay-*.tgz`）用 `npm install -g --prefix <新建临时前缀>` 装一次，**操作者真实 `HOME`、⛔ 不设 `QUAY_SKIP_PLUGIN_REGISTER` / `QUAY_SKIP_PLUGIN_CLI` / 不做 HOME 隔离**；跑完复跑 AC1 的同一条 criterion ⇒ 仍 **exit 0**，且 `~/.claude/settings.json` 的 `enabledPlugins` 键集与安装前**逐字相同**（前后各取一次读数并贴出）。
- [ ] AC4（**能取假**）：把 materialization 换回修复前语义（默认 user scope）重跑 AC3 的同一条断言 ⇒ **红**（用户级 `quay@quay` 键重现）；换回修复 ⇒ 绿。两组读数贴进结果段。
- [ ] AC5（**能力不丢**，AC-258 面向）：显式 opt-in（如 `QUAY_PLUGIN_SCOPE=user`）下同一次真实安装 ⇒ 用户级 `enabledPlugins["quay@quay"]` **确实出现**（正控制）；不设该变量 ⇒ **不出现**（即 AC3）。两条构成一对，缺一即「把能力删了」而非「把默认改了」。该 opt-in 在 `README.md` 环境变量表中有行。
- [ ] AC6（**修空转判据**）：`packages/quay/test/npm-pack-e2e.test.mjs` 里「register 不得写用户级 enabledPlugins」的断言不再只在 `QUAY_SKIP_PLUGIN_CLI=1` 下取值——新增控制：materialization 打开（或假 `claude` shim 复刻真 CLI 的 user-scope 写入）⇒ 该断言**转红**；关闭 ⇒ 绿。
- [ ] AC7（不引入新红）：`node --test packages/quay/test/npm-pack-e2e.test.mjs`、`plugin/test/quay-init.test.mjs`、`plugin/test/shipped-entry-runnable.test.mjs` 全绿；`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` ⇒ exit 0（既有 control 13 `MP_ENABLED_LEAK` 不退化）。⚠️「不产生新红」本身不是接线成功的证据，故必须与 AC3/AC4 同读。

## DoD

真实对象被操作过、判据能取假，四条缺一不可：

- `~/.claude/settings.json` 被**真实编辑过并回读**——AC-161 criterion 在生产上 **exit 0**（直接读数，不是断言）；
- **根通道被真实关闭**：一次**真实全局安装**（操作者真实 HOME）跑完后 criterion 仍 exit 0（AC3）——⛔ 只在仓库里改代码而用户级仍含 `quay@quay` ⇒ 判据仍红 ⇒ 不算达成；⛔ 只恢复状态而不堵 materialization ⇒ 下一次任何真实安装（含在飞任务的真机验证）原地复发，**前两次修已各失败过一次** ⇒ 不算达成；
- **取假对照**在修复前语义下真的转红（AC4）；显式 opt-in 的正控制真的转绿（AC5）；
- goal-driver 下一轮复跑后，`.quay/goal-round.jsonl` 中 AC-161 的 `verdict` 由 fail 翻 **pass**，且不再出现在 `achievedButFailing`。

⛔ 反序（先删用户级再确认项目级就绪）会把本机锁在「哪里都没有 quay」。

## Touches

- `packages/quay/scripts/register-plugin.mjs`
- `packages/quay/test/npm-pack-e2e.test.mjs`
- `README.md`
- `tasks/gap-ac161-postinstall-rematerializes-user-scope-enable.md`
