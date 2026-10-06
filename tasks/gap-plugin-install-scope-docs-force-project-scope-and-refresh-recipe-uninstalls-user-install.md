---
id: gap-plugin-install-scope-docs-force-project-scope-and-refresh-recipe-uninstalls-user-install
title: 面向其它项目的安装文档把 project scope 当唯一正路，刷新配方会卸载使用者的 user scope 安装；升级流程无文档
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**机制**:面向第三方项目的安装/刷新说明把 `--scope project` 写成唯一正确做法,而 AC-161 的判据代码(`goals/AC-161-user-level-marketplace-only.md`)只拦 quay 的 **dev 渠道**(quay-dev / 目录源)与 `env` 里的 quay 路径,**明确允许** 用户级 `enabledPlugins["quay@quay"]`(发布渠道)。文档比判据严。人 2026-10-06 裁定:对其它应用 quay 驱动开发的项目,**不应强调 project scope 安装**;使用者在本机做 user scope 安装;AC-161 与 SPEC §4b 的适用范围限定为 quay 自己的 dev 渠道(该裁定的文档部分已由人另行提交,不在本任务)。

**已读到的具体位置(2026-10-06)**:
1. `plugin/skills/init/SKILL.md`(约 85-129 行):"Always pass `--scope`" 并给三步配方——查记录所在 scope → 在该 scope **卸载** → `install --scope project -y`。对已 user scope 安装的使用者,照做就是卸载其 user 安装并换成 project 安装。
2. `README.md`(约 246-252 行):`claude plugin install quay@quay --scope project`,并把 user scope 写成"只有你确实需要才用"。
3. `plugin/scripts/quay-init.sh`(约 1811-1827 行,安装说明 heredoc,只打印不执行):同样 `--scope project` 与卸载再装配方,并称 `--scope user` 会让 AC-161 变红(与判据代码不符)。
4. 升级流程:仓库内只有 `init/SKILL.md:129` 一处提到 `plugin update --scope project` 在版本不变时不重建;没有"升级已安装项目"的步骤文档,也没有"升级后重跑 `/quay:init` 以刷新 `.quay/plugin` 链接"的说明(该链接由 gap-config-provider-path-frozen-to-versioned-cache-dir 引入,已 done)。

**修法**:(1) 文档改为 scope 中立:说明 user scope = 整机一个版本、升级一处;project/local scope = 按项目开关或固定版本;不再写 "Always project"。(2) 删除"卸载再装到 project"配方,改为"先 `claude plugin list --json` 查记录所在 scope,再在**该 scope** 原地 `claude plugin update quay@quay --scope <scope>`,更新后重跑 `/quay:init` 刷新 `.quay/plugin` 链接";`plugin update` 在 user 与 project 两种 scope 下的真实行为必须先实测再写入文档。(3) `quay-init.sh` 的安装说明 heredoc 同步改为检测已有 scope、已安装则不跨 scope 卸载重装;去掉"`--scope user` 会让 AC-161 变红"的不实表述,仅对 quay-dev 目录源保留禁令。⛔ `quay-init.sh` 是 sh-census 棘轮收费文件,代码行数只降不升,改动必须行数中性或净减。

<!-- dedup-ref -->相关(追溯,非前置):gap-ac161-5th-regression-refresh-recipe-not-scope-complete(done,配方的来源);gap-config-provider-path-frozen-to-versioned-cache-dir(done,引入 `.quay/plugin` 链接);gap-ac264-quay-fleet-project-scope-plugin-only-deployment(project scope 的单项目部署)。

## Touches
- `README.md`
- `plugin/skills/init/SKILL.md`
- `plugin/scripts/quay-init.sh`
- `plugin/test/quay-init.test.mjs`
- `plugin/sh-census-baseline.json`（声明面；实测**无需**改动，读数未动，见 AC5）
- `docs/analysis/quay-init-closure-ratchet.baseline.json`（`quay-init.sh` 是 laydown 源 ⇒ pre-commit 前置守卫要求指纹重锚；footprint 未膨胀）
- `tasks/gap-plugin-install-scope-docs-force-project-scope-and-refresh-recipe-uninstalls-user-install.md`

## AC
- [x] `grep -nE "Always pass .--scope.|只有你确实需要|scope user only if you mean it" README.md plugin/skills/init/SKILL.md` 命中数为 0(先打印命中前 3 条以证明谓词对改前文本能命中;改前基线读数贴进完成记录)。
- [x] `plugin/skills/init/SKILL.md` 与 `README.md` 中不再出现"卸载后 `install --scope project -y`"的连续配方:`grep -n "uninstall quay@quay --scope" plugin/skills/init/SKILL.md plugin/scripts/quay-init.sh` 命中数为 0。
- [x] `plugin/test/quay-init.test.mjs` 新增用例:捕获 `quay-init.sh` 的安装说明输出,断言其不含 `uninstall quay@quay`、不含"reddens the STANDING goal AC-161"、且含"update"与"/quay:init"升级提示;`node --experimental-strip-types --test plugin/test/quay-init.test.mjs` 退出 0。取假:把说明改回原卸载配方后该用例红(附实跑输出)。
- [x] 实测记录:在本机对一个 user scope 安装与一个 project scope 安装各实跑一次 `claude plugin update quay@quay --scope <scope>`(或在临时 CLAUDE_CONFIG_DIR 下),把命令、退出码、前后 `installed_plugins.json` 该条目差异原文贴进完成记录;文档中的升级步骤必须与该实测一致。
- [x] `bash plugin/scripts/sh-census-check.ts` 对应检查(或 `bash scripts/test.sh --for-task gap-plugin-install-scope-docs-force-project-scope-and-refresh-recipe-uninstalls-user-install`)退出 0,且 `quay-init.sh` 的代码行数不高于改前基线。

## DoD
真实落地:一个 user scope 安装了 quay@quay 的真实使用者,按改写后的 README / `/quay:init` 说明完成一次升级,全程没有被引导卸载其 user 安装,升级后 `.quay/plugin` 指向新版本目录。仅文档文本变化而无实测记录不算完成。

## Result

**实现**：分支 `task/gap-plugin-install-scope-docs-force-project-scope-and-refresh-recipe-uninstalls-user-install`，提交 `971d09f33`（merge develop 后 `da84f6e99`）。改动三处落地面 + 测试 + 一处棘轮重锚：
- `README.md` / `plugin/skills/init/SKILL.md`：删除 "Always pass `--scope`" 与 "scope user only if you mean it"，安装步骤改 scope 中立三选一（user = 整机一版本、升级一处；project = 按项目开关、版本随项目固定；local = 仅本工作副本）；新增"升级"一节：`claude plugin list --json` 查记录所在 scope → 在**该 scope 原地** `claude plugin update quay@quay --scope <scope>` → 重跑 `/quay:init` 刷新 `.quay/plugin`。去掉"user scope 会让 AC-161 变红"的不实表述，改为只对 dev 渠道（`quay@quay-dev` / 目录源 / `env` 里的 quay 路径）保留禁令。
- `plugin/scripts/quay-init.sh` 安装说明 heredoc：同步为 scope 中立、无卸载配方、带 `update` + `/quay:init` 升级提示（code-line 中性，sh-census 读数不变）。
- `plugin/test/quay-init.test.mjs`：新增 AC3 用例；原 AC4 断言由"必须 `--scope project`"改为逐个断言 `--scope user/project/local` 都出现。

**AC1**：改前基线（谓词对改前文本命中 ⇒ 证谓词非恒空，硬规则 2 的非零半边）：
```
$ grep -nE "Always pass .--scope.|只有你确实需要|scope user only if you mean it" README.md plugin/skills/init/SKILL.md
README.md:246:claude plugin install quay@quay --scope project   # scope user only if you mean it — see below
plugin/skills/init/SKILL.md:99:⚠️ **Always pass `--scope`.** `claude plugin install` defaults to `scope=user`, which writes a
```
改后同一命令无输出、exit 1 ⇒ 命中数 **0**。

**AC2**：改前基线：
```
$ grep -n "uninstall quay@quay --scope" plugin/skills/init/SKILL.md plugin/scripts/quay-init.sh
plugin/skills/init/SKILL.md:122:claude plugin uninstall quay@quay --scope <the scope just printed>
plugin/scripts/quay-init.sh:1826:  #      claude plugin uninstall quay@quay --scope <the scope just printed>
```
改后命中数 **0**（exit 1）。

**AC3**：`node --experimental-strip-types --test plugin/test/quay-init.test.mjs` ⇒ `tests 15 / pass 15 / fail 0`，含 `✔ AC3 — install note: no uninstall recipe, no false AC-161 claim, carries the update + /quay:init upgrade path`。
取假实跑（把 quay-init.sh 的说明改回旧卸载配方；**cp 备份 + 还原**，不是 git checkout）：
```
✖ AC3 — install note: no uninstall recipe, no false AC-161 claim, carries the update + /quay:init upgrade path (554.6ms)
  AssertionError [ERR_ASSERTION]: must NOT print `uninstall quay@quay` — that recipe removes a consumer's user-scope install
ℹ tests 15 / pass 14 / fail 1
```
还原后重新绿（15/15）、census exit 0。用例内另有一段"对**改前文本样本**干跑同一谓词"的自检（`OLD_NOTE`），防止 `!out.includes(...)` 写错时静默恒真。

**AC4**：实测 2026-10-06 / Claude Code 2.1.290。全部命令在**临时 `CLAUDE_CONFIG_DIR`** 下、cwd 亦为临时目录执行（不触碰本机 `~/.claude`；依据 `claude-config-dir-does-not-isolate-project-settings`：project/local scope 按 cwd 解析）。

① 发布渠道（github `yaleh/quay`），user scope 与 project scope 各装一次后各升级一次：
```
$ claude plugin update quay@quay --scope user          rc=0
Checking for updates for plugin "quay@quay" at user scope…
✔ quay is already at the latest version (0.15.0).
$ claude plugin update quay@quay --scope project       rc=0
Checking for updates for plugin "quay@quay" at project scope…
✔ quay is already at the latest version (0.15.0).
$ diff -u before.json after.json
（无差异）
```
⇒ 版本不变时 `update` 是 no-op，`installed_plugins.json` 逐字节不变。

② 版本真的变化（目录源 probe 副本，0.15.0 → 0.99.0），user scope：
```
$ claude plugin update quay@quay --scope user          rc=0
Checking for updates for plugin "quay@quay" at user scope…
✔ Plugin "quay" updated from 0.15.0 to 0.99.0 for scope user. Restart to apply changes.
--- before.json
+++ after.json
       {
         "scope": "user",
-        "installPath": "/tmp/.../cache/quay/quay/0.15.0",
-        "version": "0.15.0",
+        "installPath": "/tmp/.../cache/quay/quay/0.99.0",
+        "version": "0.99.0",
         "installedAt": "2026-10-06T00:18:40.155Z",
-        "lastUpdated": "2026-10-06T00:18:40.155Z"
+        "lastUpdated": "2026-10-06T00:18:40.626Z"
       }
```
project scope 同形：`✔ Plugin "quay" updated from 0.15.0 to 0.99.0 for scope project (<proj>). Restart to apply changes.`，rc=0；entry 保留 `scope` / `projectPath` / `installedAt`，只有 `installPath` / `version` / `lastUpdated` 变化；项目 `.claude/settings.json` 的 `enabledPlugins: {"quay@quay": true}` 不变，另一 scope 的 settings 文件未被写入。

③ 猜错 scope（记录在 project，命令给 user）：
```
$ claude plugin update quay@quay --scope user          rc=1
✘ Failed to update plugin "quay@quay": Plugin "quay" is not installed at scope user
```
⇒ 失败关闭，记录不被搬到别的 scope。

三条结论与改写后的 README / SKILL.md / `quay-init.sh` 输出里的升级步骤逐条一致（"先查 scope → 在该 scope 原地 update → 重跑 `/quay:init`"）。

**AC5**：`node --experimental-strip-types plugin/scripts/sh-census-check.ts --json` ⇒ `totals.embeddedInterpreterLines = 7694`（= committed baseline `7694`）、`duplicateCopies = 0`、`files[plugin/scripts/quay-init.sh].codeLines = 1011`（**改前 1011 / 改后 1011**，不高于基线；改动全在 heredoc 体内，其 `#` 行与空行不计 code-line），检查器 **exit 0**。
`bash scripts/test.sh --for-task gap-plugin-install-scope-docs-force-project-scope-and-refresh-recipe-uninstalls-user-install --allow-thin` ⇒ **EXIT=0**（静态 scoped 门 + `plugin/test/quay-init.test.mjs` 15/15 绿）。
另：`quay-init.sh` 是 laydown 源 ⇒ pre-commit 前置守卫（`quay-init-closure-ratchet.ts`）要求重锚 `docs/analysis/quay-init-closure-ratchet.baseline.json`。先按守卫要求**分类**：`--gate` 绿（`laydown footprint 3 files / 1022 bytes ≤ baseline 3 files / 1022 bytes`，**未膨胀**，只是源内容变化导致指纹过期）⇒ 走守卫指定的 ② 路径机械 `--reanchor`，`--check-stale` 随后 PASS。**不是**用重锚放宽棘轮。

**硬规则 5b（同一原则的其它适用点：扫描 + 前 3 条）**：
```
$ grep -rn "uninstall quay@quay" --include=*.md --include=*.sh --include=*.ts --include=*.mjs . | grep -v node_modules
plugin/scripts/quay-init.sh:1826   ← 本任务已修
plugin/skills/init/SKILL.md:122    ← 本任务已修
packages/quay/scripts/register-plugin.mjs:81   `(2) ALWAYS install with --scope project.`
packages/quay/scripts/register-plugin.mjs:262  claude plugin install   ${pluginRef} --scope project -y
packages/quay/scripts/register-plugin.mjs:276  （同配方第二条路径）
```
`packages/quay/scripts/register-plugin.mjs`（`npm install -g quay` 的 postinstall，会把说明打印给使用者）仍有 "ALWAYS install with `--scope project`" 与同一"resolve → uninstall → install --scope project"配方（2 处 `console.log` + 头部 46-86 行注释）。**本任务未改它**，两条理由：① 人 2026-10-06 裁定的**文档侧**落地范围与本体立案/Touches 一致，`register-plugin.mjs` 不在其中（人自己的提交 b9294db17 也只点了本任务）；② 它那段配方的场景不同——"**已损坏的共享 cache payload 重填**"，实测证明 `plugin update` 对该场景是 no-op（0→0 文件），照搬本任务的"原地 update"会让该路径失去修复手段。⇒ 记为**同族待办**（需按同一裁定单独改文案，并对 damaged-cache 场景单独实测），不在本任务内静默扩范围。

**DoD 说明**：改写后的三条落地面（README / SKILL.md / `quay-init.sh` 输出）的升级步骤与 AC4 实测逐条一致；`.quay/plugin` 的重指向由 `refreshProjectPluginLink`（`packages/quay/src/init.ts`）在重跑 `/quay:init` 时完成，文档正是这么写的。本机发布渠道当前最新即 0.15.0（`git ls-remote origin dist-plugin` = `b0e7137944a739bae00155f34f87930ef4550bf2`，与已装 0.15.0 记录的 `gitCommitSha` 相同）⇒ **本机当前不存在可比的新版本**，"真实使用者完成一次升级"只能以 ② 的版本变更臂作为等价实测；如实记录，不冒充真机升级。