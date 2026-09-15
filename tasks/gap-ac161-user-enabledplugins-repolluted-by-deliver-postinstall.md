---
id: gap-ac161-user-enabledplugins-repolluted-by-deliver-postinstall
title: ad-arm1 用户级 enabledPlugins 出现 quay@quay ⇒ AC-257 记录被 AC-161
  常设闸拒写：写入者【已定位】= 09-14 05:28 那次 `npm install -g` 的【修复前】postinstall（line 175 无
  `--scope` ⇒ CLI 默认 user）；原「已证伪」结论只覆盖了修复后的版本
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: v1
goal_ac: AC-161
---
## Finding

**观察（可核）**：2026-09-15 在 ad-arm1 上跑 AC-257 交付腿时，`write_ac257_record` 落盘前读用户级
（`ac161_user_scope_quay_state`，三取值 `absent | present:<键> | unreadable:<因>`），读到
`present:quay@quay` 而拒写，整趟已经真正跑完的 AC-257 一条记录都落不下：

```
AC161-USER-SCOPE: GOAL-018-AC-257 record refused — state=present:quay@quay — user-level ~/.claude/settings.json
enabledPlugins still carries a quay key; this record's project-scope premise is FALSE → nothing written (standing goal AC-161)
```

当场读数（当时）：

```
$ stat -c '%y' ~/.claude/settings.json      -> 2026-09-15 16:57:41.775120247 +0000
$ grep -c 'quay@quay' ~/.claude/settings.json -> 1
$ python3 -c "...json...['enabledPlugins']"  -> {"quay@quay": true}
$ python3 -c "...json...['extraKnownMarketplaces']['quay']" -> {"source":{"source":"directory",
      "path":"/home/yale/.local/opt/quay/0.7.0-dev/lib/node_modules/quay/plugin"}}
```

当时的临时处置（已做）：只删 `enabledPlugins["quay@quay"]`（保留 `extraKnownMarketplaces.quay`，AC-161 的
doctrine 要求用户级只留 marketplace 源），再重跑一次记录写 ⇒ 记录成功落账
（`quay_version=0.7.0-dev`、`user_scope_quay_state=absent`）。读数见
`.quay/ac259-evidence/ac161-depollution.txt`。

## Result（写入者已定位 —— 对照见 AC2）

**结论**：ad-arm1 用户级 `enabledPlugins["quay@quay"]` 的写入者是**交付管线自己那次
`npm install -g --prefix /home/yale/.local/opt/quay/0.7.0` 的 npm postinstall**
（`packages/quay/scripts/register-plugin.mjs` 的**修复前**修订版，sha256
`bd3d26d50be6e460042c12ca8d428775fbb35fe989eb46d45daa1ab1506f53e5`），它 **无条件下发** 这一条 CLI 调用：

```js
// git 86e5c1db4^ : packages/quay/scripts/register-plugin.mjs:175   （与 ad-arm1 上装着的那份逐字节相同）
const install = runCli(["plugin", "install", `${pluginName}@${marketplaceName}`]);
```

**不带 `--scope`** ⇒ 取 Claude Code CLI 默认 scope `user` ⇒ 写用户级键 **并**建一条 user-scope
`installed_plugins.json` 记录。**时刻 = `2026-09-14T05:28:28.117Z`**（直接读该记录的 `installedAt`）。

**⛔「原假说已被证伪」是一个过宽的结论，本次予以下修**：那条对照跑的是**修复后**的 tarball（0.7.0-dev，
09-15 构建），其中 enable 步已被 `QUAY_PLUGIN_SCOPE` 闸住。而该闸**首次出现**于 `86e5c1db4`，落地
`2026-09-14T23:02:53Z` —— **比那次写入晚 17h34m**（`git log -S QUAY_PLUGIN_SCOPE` 恰好一条）。故那条对照
排除的是**修复后**的 postinstall，**从未覆盖当时真正在跑的那个配置**。原假说**渠道对、时机错**。

**16:57:41 那个 mtime 不是写入证据**：`register-plugin.mjs` 第 6 步**无条件**整份重写 `settings.json`
（tmp+rename，保留其它键）⇒ 任何一次全局安装都会刷新 mtime，无论它有没有新增键。已实测（ARM R）。
09-15 16:57:41 那次装的是 **0.7.0-dev（修复后）**，它刷新的是一把 **09-14 就在**的键的 mtime。

### 原文位置（AC3）

* **ad-arm1 上装着的那份**：`/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/scripts/register-plugin.mjs`
  `sha256 = bd3d26d50be6e460042c12ca8d428775fbb35fe989eb46d45daa1ab1506f53e5`，
  `grep -c QUAY_PLUGIN_SCOPE` = **0**（0.7.0-dev 那份 = **6**），
  enable 行 `runCli(["plugin", "install", ...])` —— **无 `--scope`**。
* 该哈希与 `git show 86e5c1db4^:packages/quay/scripts/register-plugin.mjs` **逐字节相同**。
* **关掉这条通道的修复**：`86e5c1db4`「AC-161 (3rd regression): register-plugin no longer enables the
  plugin at user scope by default」2026-09-14T23:02:53Z ⇒ enable 改为 `QUAY_PLUGIN_SCOPE` 显式 opt-in。
  **修法所需读数本就在树里**；缺的是**对留存那把键的归因**，即本节。

### 时机读数（ad-arm1）

```
$ stat -c '%y' /home/yale/.local/opt/quay/0.7.0                     -> 2026-09-14 05:28:01.25
$ stat -c '%y' .../0.7.0/lib/node_modules/quay/scripts/register-plugin.mjs -> 2026-09-14 07:47:18
user-scope 记录: {"scope":"user", ... "installedAt":"2026-09-14T05:28:28.117Z",
                  "lastUpdated":"2026-09-14T05:28:28.117Z"}          # 此后从未更新
project-scope 记录(/home/yale/work/archguard): installedAt 2026-09-14T05:28:51.486Z
~/.claude/plugins/installed_plugins.json mtime -> 2026-09-14 07:13:36  # 09-15 一整天没写过
```

序列：prefix 于 05:28:01 建立 ⇒ postinstall（修复前）⇒ **05:28:28.117 建 user-scope 记录**；
`/tmp/ac257-install.sh` 于 05:28:45 写入（内容是 `claude plugin install quay@quay --scope project -y`）⇒
**05:28:51.486 建 project-scope 记录**。两条记录相隔 23 秒，由**两个不同动作**产生，第二个动作的脚本
原文可读。

### 残留（明写，不隐藏 —— 硬规则 3b）

**ad-arm1 上 09-14 05:28 那次安装的 npm debug log 没有留存**：`~/.npm/_logs/` 只剩 12 个文件，最老
`2026-09-15T17_14_44`，**09-14 的 0 个**。故那次 npm install 被**发起**这一点，证据是 **prefix 目录 mtime**
（05:28:01）+ 安装记录时刻，**不是** npm 日志。**机制侧不依赖这个环节**：ARM P 用同一个 artifact 复现出了
完全相同的指纹。未核实的只是「npm 在 05:28:01 跑过」，不是「这份 artifact 会写这把键」。

## 被证伪的假说（⛔ 不要再按它行动）

**原假说**：这个键是**交付管线自己的** `npm install -g` postinstall（`packages/quay/package.json` 的
`"postinstall": "node scripts/register-plugin.mjs"`）写的；证据是 `settings.json` 的 mtime `16:57:41`
恰好是那次 npm install 的时刻。

**若该假说为真则结果会不同的对照（已跑，硬规则 4 推论四）**：在 ad-arm1 上用**沙箱 HOME** 各跑一次
同名 postinstall，两次的 `enabledPlugins` 命中都是 **0**：

```
$ command -v claude                        -> /home/yale/.local/bin/claude   (claude_rc=0)
control A（只换 HOME）:  HOME=/tmp/ac259sbA npm install -g --prefix /tmp/ac259pfA <quay.tgz> <qn.tgz>
   sandboxA settings.json written=yes ; enabledPlugins 'quay@quay' hits=0
control B（换 HOME 且带声明的 endpoint 环境，claude 可认证）:
   sandboxB settings.json written=yes ; enabledPlugins 'quay@quay' hits=0
   sandboxB settings.json == {"extraKnownMarketplaces":{"quay":{"source":{"source":"directory",
       "path":"/tmp/ac259pfB/lib/node_modules/quay/plugin"}}}}
```

⇒ postinstall 只写 marketplace 源，**不写**用户级 `enabledPlugins`，与 `register-plugin.mjs` 自己的头注释
（「It does NOT write a user-level enabledPlugins entry — enabling is left to the target project's
`<repo>/.claude/settings.json` (AC-161)」）逐字一致。**原假说被证伪**，本条的 Requested action 随之作废。

完整读数：`.quay/ac259-evidence/ac161-attribution-control.txt`。

⚠️ **下修（见 ## Result）**：上面两条对照用的 tarball 是**修复后**的版本（enable 步已被
`QUAY_PLUGIN_SCOPE` 闸住），所以它们排除的是**修复后**的 postinstall。写入者确是 postinstall，
但是**修复前**那一份。本节的「被证伪」只对 09-15 那次 mtime 归因成立，**不可**推广为
「postinstall 与这把键无关」。

## 未决问题（本条真正的可行动部分）

**ad-arm1 上那个用户级 `enabledPlugins["quay@quay"]` 到底是哪个动作写的，目前未识别。**
已知约束：
- 写入时刻 `16:57:41` 落在 AC-257 交付腿的 `npm install -g` 窗口内，但 postinstall 已被上面两条对照排除；
- `[⑨f]`（`claude plugin marketplace add/install --scope project`）在**其后**运行，且运行后 `settings.json`
  的 mtime 未再变化 ⇒ 也不是它；
- ad-arm1 上并存着若干**别的** quay 项目（`/home/yale/quay-verify-coldstart-*.npm` 下的前缀，且这些 root
  有常驻 promotion/goal driver）——「另一个在飞 agent 或另一条交付腿写了它」尚未被排除，但也未被证实。

⚠️ 这正是硬规则 4 推论四说的形态：「一个能【解释】现象的说法，不是一个被【检验】的结论」。
本条的原文（把成因直接归给 postinstall）已经犯过一次，⛔ 不要再在未做对照的情况下换一个新成因写进来。

⇒ **本节已被 ## Result 关闭**：写入者已定位（保留原文以留推理轨迹）。

## Requested action

1. **先取证，再下结论**：用与上面同一手法（沙箱 HOME + 逐项放行一个变量）把 `16:57:41` 那个写入者定位到
   一个**具体动作**上；在此之前不得给出成因。
2. 判据必须能区分「postinstall 写的」与「别的动作写的」：例如在真实交付腿前后各读一次用户级
   `enabledPlugins` 键集，并在**跑腿的同时**记录 ad-arm1 上还有哪些 quay 进程在跑（`ps` 读数）。
3. 若最终定位不到写入者，正确输出是**带原文报到人**（记 `needs-human`），⛔ 不是换一个听起来合理的成因。

## Acceptance Criteria

- [x] AC1 贴出「交付腿前后用户级 `enabledPlugins` 键集」的一对真实读数（ad-arm1），并同时贴出该时刻 ad-arm1 上在跑的 quay 进程清单（`ps`，位置判定）。

  | | 用户级 `enabledPlugins` 键集 | settings.json mtime |
  |---|---|---|
  | 腿前（故意播种未修态） | `['quay@quay']` | 2026-09-15 17:55:00.628 |
  | 腿后（腿已跑完、记录被拒） | `['quay@quay']` —— **未变** | 2026-09-15 17:55:00.628（**未变**） |

  `ps` 于腿窗口（17:55:00Z–17:55:29Z）每 10s 采样一次（ad-arm1）。**跑腿期间**在跑的 quay 进程
  （按位置判定）：`quay-verify-coldstart-17858ba8.npm` / `-b8bafe26.npm` / `-f29a5a01.npm` 三对
  `driver-runtime.js __supervise --kind promotion|goal` + `promotion-driver.js`/`goal-driver.js`
  （另有 `ready-pool-check.js --cap 5 --apply --json`、`process-budget.sh`）、
  `quay-verify-coldstart/verify-ac107-c-rerun.npm/.../vendor/quay/dist/quay.js mcp`、
  `quay-verify-takeover-1d916698.npm/.../dist/quay.js serve --host 100.100.148.48 --port 4173`、
  `.local/opt/quay/0.7.0-dev/.../dist/driver-anchor.js __anchor --root /home/yale/work/archguard`、
  `quay-ac88-project/plugin/scripts/session-liveness.sh`。
  ⇒ ad-arm1 上**常驻三对**别的 quay 项目的 promotion/goal driver，跑任何腿时都在跑。
  读数：`.quay/ac161-attribution/ac1-before-leg.txt`、`ac1-after-leg1.txt`。
- [x] AC2 用一个**能区分**的对照把写入者定位到具体动作（对照须给出「若假说为假则结果不同」的方向）；⛔ 不得只贴一条自洽的解释。

  **唯一变量 = artifact 修订版**（ad-arm1，沙箱 HOME，跑**盘上装着的那两份**原物：
  `HOME=<sbx> npm_config_global=true node <installed>/scripts/register-plugin.mjs`）：

  | 臂 | artifact | 预置键 | 跑后 `enabledPlugins` | 沙箱内 user-scope 记录 |
  |---|---|---|---|---|
  | **P** | **修复前** `sha256 bd3d26d5…`（= ad-arm1 自 09-14 起装着的那份） | 无 | **`{"quay@quay": true}`** | **新建**，`scope:"user"`，`installedAt` = 跑的时刻 |
  | **Q** | 修复后 `sha256 36dc1923…`（09-15 装的） | 无 | `null` | 无 |
  | **R** | 修复后 `sha256 36dc1923…` | **有** | **`{"quay@quay": true}` 保留** | 无 |

  ARM P 逐字输出：`Successfully added marketplace: quay (declared in user settings)` /
  `Successfully installed plugin: quay@quay (scope: user)`；
  ARM P 的 `installed_plugins.json` = `{"scope":"user", "installPath":".../cache/quay/quay/0.7.0",
  "installedAt":"<跑的时刻>", "lastUpdated":"<跑的时刻>"}` —— 与 ad-arm1 那条**同形**（`scope:"user"`、无 `projectPath`）。

  **可区分方向**：P 预测「键出现」，Q 预测「键不出现」，两臂**只差 artifact 修订版**。P 胜 ⇒ 修复前的
  postinstall 是一个**充分且 scope 正确**的写入者。（反方向即已有的对照：修复后 + 未设
  `QUAY_PLUGIN_SCOPE` ⇒ 命中 0。）

  ARM R 是**mtime 陷阱对照**：预置键 + 修复后 artifact ⇒ 键**保留**、文件 md5 **变了**
  （`9abc37f6…` → `364586aa…`）、mtime **被刷新** —— 这正是 ad-arm1 那个 16:57:41 mtime 的来历。
- [x] AC3 若定位成功：贴出该动作的原文位置与修法所需的读数；若定位不到：贴出已穷尽的候选与各自的排除读数，并记 `needs-human`。

  **定位成功**（原文位置见 ## Result「原文位置」）：ad-arm1 装着的那份
  `/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/scripts/register-plugin.mjs`
  `sha256 bd3d26d5…`，`QUAY_PLUGIN_SCOPE` 计数 **0**，enable 行
  `runCli(["plugin", "install", `${pluginName}@${marketplaceName}`])` **无 `--scope`**；该哈希与
  `git show 86e5c1db4^:...register-plugin.mjs` **逐字节相同**。关掉该通道的修复 = `86e5c1db4`
  （2026-09-14T23:02:53Z）= enable 改 `QUAY_PLUGIN_SCOPE` opt-in。**不记 `needs-human`**。
- [x] AC4 复现原始现象：在**未修**状态下（用户级带 quay 键）跑一次 AC-257 交付腿，贴 `AC161-USER-SCOPE: … record refused … present:quay@quay` 原文；再证删除该键后同一交付腿能写出记录（两次都贴）。⚠️ 这证明的是**闸门按设计工作**，不是成因。

  **Run 1（未修：用户级带键）**，ad-arm1，17:55:08Z：
  ```
    [⑨a] installed quay_version=0.7.0-dev    [⑨d] quay-init --force rc=0 (rerun=true)
    [⑨e] AFTER hooks.Stop md5=e5255b86660f verbatim-preserved=1 ; enabledPlugins={"quay@quay":true}
    [⑨f] project-scope install: marketplace-add rc=0 install rc=0
    [⑨k] task_status=done commit_sha=ef48077ae710 ... produced_by_driver=1 evaluated=1
  AC161-USER-SCOPE: GOAL-018-AC-257 record refused — state=present:quay@quay — user-level ~/.claude/settings.json enabledPlugins still carries a quay key; this record's project-scope premise is FALSE → nothing written (standing goal AC-161)
    AC257-NOT-EVALUATED: write_ac257_record 拒写（fail-closed: ...）⇒ 未落账
  verify-deliver-coldstart: FAIL      SSH_RC=1
  ```
  其余每一步全绿 ⇒ **唯一**拦路的就是用户级那把键。

  **Run 2（删键、保留 marketplace 源）**，同一条腿，17:55:43Z：
  ```
    ac257 record written → /home/yale/quay-verify-ac257-evidence-manual.jsonl ✓
  AC257_WRITTEN_THIS_RUN=1     SSH_RC=0
  ```
  主机侧记录（逐字），经脚本自己的 `transport_evidence_append` 落进载体（⛔ 非手写 JSONL）：
  ```json
  {"build_sha":"7f0ee27eb1ced5520e4ecbc493e876cb5893e2f5","ts":"2026-09-15T17:55:43Z",
   "ac":"GOAL-018-AC-257","host":"ad-arm1","project_root":"/home/yale/work/archguard",
   "install_scope":"project","quay_version":"0.7.0-dev","quay_init_rerun":true,"merge_preserved":true,
   "marketplace_path":"...plugin","provider_path":"...vendor/quay-native","task_status":"done",
   "commit_sha":"ef48077ae710d52cf51961886cd7756e7a05806d","produced_by_driver":true,
   "user_scope_quay_state":"absent"}
  ```
  载体 `.quay/productization-verification.jsonl` 183 → 184 行。
  读数：`.quay/ac161-attribution/ac4-run1-polluted.log`、`ac4-run2-clean.log`、`ac4-run2-record.txt`。

  收尾：ad-arm1 用户级 `enabledPlugins = {}`、quay 键命中 0、`extraKnownMarketplaces.quay` 保留、
  AC-161 谓词 ⇒ `absent`；沙箱与 `ps` 采样器已清除（`ac4-after-cleanup.txt`）。

## Definition of Done

- [x] 用户级那个键的写入者被定位到具体动作，或明确记为 `needs-human` 并附已穷尽的候选与排除读数。
      ⇒ **已定位**：09-14 05:28:28 那次 `npm install -g --prefix /home/yale/.local/opt/quay/0.7.0` 的
      postinstall（`register-plugin.mjs` 修复前修订版，`sha256 bd3d26d5…`，line 175 无 `--scope` ⇒ 默认 user）。
- [x] 本条的成因表述有对照支撑（AC2），⛔ 不是「看起来最合理的那一个」。
      ⇒ 对照 P/Q/R，唯一变量是 artifact 修订版，两个方向都给出相反预测。
- [x] AC4 的两条读数在记录里（证明闸门工作正常、且绕法确实能解锁记录）。⇒ Run 1 拒写原文 + Run 2 落账记录。

## Touches

- tasks/gap-ac161-user-enabledplugins-repolluted-by-deliver-postinstall.md

Note: filed and then corrected by the AC-259 re-anchoring worker. The correction exists because the worker ran the falsifying control after filing (`.quay/ac259-evidence/ac161-attribution-control.txt`).

Attribution completed 2026-09-15 by the worker for this task: the writer is identified (see ## Result);
the earlier "postinstall 已被证伪" verdict is narrowed to "the POST-FIX postinstall was excluded" —
the fix (`86e5c1db4`) landed 17h34m AFTER the write, so that control never covered the configuration
that ran. Full readings: `.quay/ac161-attribution/EVIDENCE-BUNDLE.md`.
