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

- [x] AC1: 逐字跑 `goals/AC-161-user-level-marketplace-only.md` 的 criterion（python3 heredoc 原文）⇒ **exit 0**（立案当轮实测 exit 1，`CAUSE=user-enabled-plugins — …: quay@quay`）。
- [x] AC2: 用户级 marketplace 源不再指向临时前缀——`python3 -c "import json,os,sys;d=json.load(open(os.path.expanduser('~/.claude/settings.json')));p=((d.get('extraKnownMarketplaces') or {}).get('quay') or {}).get('source',{}).get('path','');sys.exit(1 if '/tmp/' in p else 0)"` ⇒ exit 0；同一条断言对 `~/.claude/plugins/known_marketplaces.json` 的 `quay.installLocation` 也 ⇒ exit 0（立案当轮两者都指向 `/tmp/quay-install-PREFIX-20260914-214317/…` ⇒ exit 1）。
- [x] AC3（**读生产载体，不是夹具**）：把**真实产物 tarball**（`plugin/scripts/develop-deliver-tgz.sh` / `package.sh` 产出的 `quay-*.tgz`）用 `npm install -g --prefix <新建临时前缀>` 装一次，**操作者真实 `HOME`、⛔ 不设 `QUAY_SKIP_PLUGIN_REGISTER` / `QUAY_SKIP_PLUGIN_CLI` / 不做 HOME 隔离**；跑完复跑 AC1 的同一条 criterion ⇒ 仍 **exit 0**，且 `~/.claude/settings.json` 的 `enabledPlugins` 键集与安装前**逐字相同**（前后各取一次读数并贴出）。
- [x] AC4（**能取假**）：把 materialization 换回修复前语义（默认 user scope）重跑 AC3 的同一条断言 ⇒ **红**（用户级 `quay@quay` 键重现）；换回修复 ⇒ 绿。两组读数贴进结果段。
- [x] AC5（**能力不丢**，AC-258 面向）：显式 opt-in（如 `QUAY_PLUGIN_SCOPE=user`）下同一次真实安装 ⇒ 用户级 `enabledPlugins["quay@quay"]` **确实出现**（正控制）；不设该变量 ⇒ **不出现**（即 AC3）。两条构成一对，缺一即「把能力删了」而非「把默认改了」。该 opt-in 在 `README.md` 环境变量表中有行。
- [x] AC6（**修空转判据**）：`packages/quay/test/npm-pack-e2e.test.mjs` 里「register 不得写用户级 enabledPlugins」的断言不再只在 `QUAY_SKIP_PLUGIN_CLI=1` 下取值——新增控制：materialization 打开（或假 `claude` shim 复刻真 CLI 的 user-scope 写入）⇒ 该断言**转红**；关闭 ⇒ 绿。
- [x] AC7（不引入新红）：`node --test packages/quay/test/npm-pack-e2e.test.mjs`、`plugin/test/quay-init.test.mjs`、`plugin/test/shipped-entry-runnable.test.mjs` 全绿；`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` ⇒ exit 0（既有 control 13 `MP_ENABLED_LEAK` 不退化）。⚠️「不产生新红」本身不是接线成功的证据，故必须与 AC3/AC4 同读。

**逐条读数 → `## Result（本轮证据）` 段。**

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

## Result（本轮证据，2026-09-14）

**实现**（commit `86e5c1db4`；随后 merge develop ⇒ `8777c05b4`）：

- `packages/quay/scripts/register-plugin.mjs`：materialization 的 **enable 步改为显式 opt-in**。默认只跑 `claude plugin marketplace add <pluginDir>`（用户级只留 marketplace 源，AC-161 语义）；仅当 `QUAY_PLUGIN_SCOPE=user|project|local` 时才额外跑 `claude plugin install <ref> --scope <scope>`。未设 / 不识别 ⇒ 只注册不启用（fail-closed 方向）。删除了 `:132-147` 的 RESIDUAL 段，换成文件头的 SCOPE POLICY 说明与 guard-rail 一行。
- `packages/quay/test/npm-pack-e2e.test.mjs`：新增「ENABLE 通道默认关闭」控制。用假 `claude` shim 复刻真 CLI 的 user-scope 写入（含调用日志）。两半：(a) `QUAY_PLUGIN_SCOPE=user` ⇒ shim 被调用、键出现；(b) 默认 ⇒ 调用日志里**没有** `plugin install` 行、键不存在。
- `README.md`：环境变量表新增 `QUAY_PLUGIN_SCOPE` 行；Option A 的 fallback 命令块加 `--scope project` 与默认语义说明。

**AC 读数**：

| AC | 读数 |
|---|---|
| AC1 | criterion 从 goal 文件 heredoc **提取后逐字跑**（非手抄）⇒ **exit 0** |
| AC2 | cmd1 `settings.json` 的 path = `/home/yale/work/quay/plugin` ⇒ exit 0；cmd2 `known_marketplaces.json` 的 `quay.installLocation` = `/home/yale/work/quay/plugin` ⇒ exit 0 |
| AC3 | 真 tarball `quay-fixed.tgz`（sha256 `7e2f1536cb6a0a9295bdd12d2141ee01b6ce44ab5b2e66c91f9b2a52d9b1083b`，`package.sh` 产出）；`npm install -g --prefix /tmp/ac161/prefix-fixed`，真实 HOME、无 skip 变量、无隔离 ⇒ criterion **exit 0**；`enabledPlugins` 键集 前 = 后 = `["archguard@archguard","meta-cc@meta-cc-marketplace"]`（**逐字相同**）。整文件 sha256 前 `9bcdb5e5…` → 后 `ab8c3b96…`，用重建哈希证明**差异只在** `extraKnownMarketplaces.quay.source.path`（重建后 sha 与安装前逐字相符） |
| AC4 | 先恢复到干净基线（criterion exit 0）⇒ 装**修复前**脚本的 tarball `quay-prefix.tgz`（sha256 `b998d0fb37c4b9e4b4e73fdefab02b9a856f839e8ee29fa111351e069b651bd9`）⇒ `enabledPlugins` 重现 `"quay@quay": true`、criterion **exit 1**（`CAUSE=user-enabled-plugins — …: quay@quay`）；换回修复 ⇒ exit 0 |
| AC5 | `QUAY_PLUGIN_SCOPE=user npm install -g --prefix /tmp/ac161/prefix-optin quay-fixed.tgz`（真实 HOME）⇒ `enabledPlugins` **确实出现** `"quay@quay": true`（正控制）；不设该变量 ⇒ 不出现（= AC3）。README 环境变量表已有该行 |
| AC6 | prefix-code-swap 控制（同一断言、同一 shim、默认 env）：**修复前**脚本 ⇒ 断言 **FAIL**（shim 调用日志 = `plugin marketplace add … | plugin install quay@quay`，键 = true）；**修复后** ⇒ **PASS**（日志只有 `plugin marketplace add …`，键 = undefined）。⇒ 断言能取假，且新控制真的穿过 enable 通道 |
| AC7 | `node --test packages/quay/test/npm-pack-e2e.test.mjs` **10/10 绿**（含新控制）；`plugin/test/quay-init.test.mjs` **14/14 绿**；`plugin/test/shipped-entry-runnable.test.mjs` **2/2 绿**；`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` ⇒ **exit 0**，其中 control 11 `MP_EVALUATED=1 MP_REGISTER_OK=1 MP_SETTINGS_OK=1 MP_ENABLED_LEAK=0`、control 13 `MP_SETTINGS_OK=0 MP_ENABLED_LEAK=1`、control 12 `0`、control 14 `0/1/1`、control 45/46 `1/1/1/1` 与 `0/0` 全部未退化 |

**为「能取假」而造的对照**（硬规则 4 推论四）：① 修复前安装把 `settings.json` 的 marketplace 路径写成**该次安装自己的临时前缀**（`/tmp/ac161/prefix-prefix/…`）——手工 `claude plugin install` 不会产生该路径，故「污染来自 postinstall 链」有对照；② AC4 从**干净基线**（先 exit 0）出发再装 ⇒ 排除「本来就红所以红」；③ AC6 的 (a) 半真的写出违规键 ⇒ (b) 半的绿不是空转。

**状态恢复（Plan 步骤 1，顺序 ①→④）**：① 项目级 `/home/yale/work/quay/.claude/settings.json` = `{"enabledPlugins":{"quay@quay":true}}`（读回）；② `installed_plugins.json` 里 `quay@quay` 的 `scope:"project"`（`projectPath=/home/yale/work/quay`）记录在 ⇒ 删用户级不会锁死；③ 删用户级 `enabledPlugins["quay@quay"]`；④ `claude plugin marketplace add /home/yale/work/quay/plugin` ⇒ `settings.json` 与 `known_marketplaces.json` 两处路径都回到 `/home/yale/work/quay/plugin`。

**⛔ 本 worker 不声称的部分**：DoD 第 4 条（goal-driver 下一轮把 `.quay/goal-round.jsonl` 里 AC-161 的 `verdict` 由 fail 翻 **pass**、并从 `achievedButFailing` 消失）由 **goal-driver 的下一轮**产生，非本 worker 可观测 ⇒ **此处不作声称**。

**硬规则 5b 扫描（同形实例，全仓 `claude plugin install` 调用点 4 处，默认 user scope 的另 2 处本轮未改，逐条给理由）**：

1. `plugin/scripts/verify-deliver-coldstart.sh:4038` `claude plugin install "quay@quay" -y`（`:4034-4040`）—— 属 **AC-258** 的 user-scope 物化兜底腿，该任务（`gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved`，Touches 含本文件与 `quay-init.sh`，现已 done）的判据**要求** user scope（selfcheck 明写 `install_scope must be user` / `project 取值必须被写入期闸挡住`）⇒ 本轮改它等于与 AC-258 的方向对撞，**不动**。**但该处 `:4025-4032` 的注释把 register-plugin.mjs 描述为「自己会调两条 CLI 命令 … runCli(["plugin","install",pluginRef])」——修复后该默认已不成立，是本轮引入的一处陈旧注释**，登记在此供 AC-258 侧或后续任务修正。同一腿在无 `claude` 的宿主上会退化为 `not-attempted`（该边界 AC-258 自陈存在于 B/C，本轮不改变它，但后续重跑需知悉主线已改由兜底腿承担）。
2. `plugin/scripts/quay-init.sh:2648` 打印给用户的 `claude plugin install quay@quay`（无 `--scope`）—— 同属 AC-258 的 quay-init / user-scope 领地（任务名即 `…user-scope-quay-init-merge-preserved`）⇒ **不动**，登记为同形实例。

（另 2 处 `verify-deliver-coldstart.sh:3709-3711` 已显式 `--scope project`，无问题。）
