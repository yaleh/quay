---
id: gap-ac161-5th-regression-refresh-recipe-not-scope-complete
title: AC-161 第五次回归：共享 cache 刷新的「两步配方」在记录实际位于 user scope 时第一步不可执行——CLI 自己的报错把人指到
  `--scope user`，而写出那条 user-scope 记录的正是本仓交付路径自己
status: todo
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

**问题**：STANDING goal AC-161（GOAL-003，`long-term: true`，status 已 achieved）**第五次失败**——被它保证的事实当前不成立。立案当轮把 `goals/AC-161-user-level-marketplace-only.md` 的 frontmatter `criterion`（折叠块）**原文提取后逐字跑**（⛔ 不手抄）：

```
CAUSE=user-enabled-plugins — user-level enabledPlugins still enables quay plugin(s): quay@quay
RC=1
```

`~/.claude/settings.json` 现状：`enabledPlugins` 含 `"quay@quay": true`；`extraKnownMarketplaces.quay.source.path` = `/home/yale/work/quay/plugin`（**本次未被污染**，回归读数里它是干净的）；无 `env` 键（故 criterion 只走到 `enabledPlugins` 那条分支）。该文件 **sha256 = `691eebf7e7c208c35d4d5c93e8708c389dd720f819bae2354694b142ef6f2681`**，mtime `2026-09-15 12:42:44.751612855 +0000`——**逐字节等于第四次回归立案时记录的那份污染态**（`691eebf7…f2681`），且 ≠ 第四次修复后的干净态（`95fa6714…c9661`）。

`installed_plugins.json`：`quay@quay` 名下 8 条记录，其中**唯一一条非 project** 是 `{"scope":"user","installPath":"~/.claude/plugins/cache/quay/quay/0.7.0","version":"0.7.0","installedAt":"2026-09-15T12:42:45.146Z","gitCommitSha":"a1f5eeb397694941effbd87a4973cc4043062c25"}`。

### 回归时间线（逐条独立读数，非同形推断）

| 时刻 (UTC) | 读数 | 载体 |
|---|---|---|
| 12:40:04.610 | AC-161 goal gate **pass** | `.quay/gate-events.jsonl`（`item_id=AC-161`, `gate=goal`, `actor=goal-cli`） |
| **12:42:27.085** | 在飞 agent 跑 `claude plugin uninstall quay@quay --scope project`，工具描述逐字 **"Uninstall quay plugin to clear the shared cache entry (step 1 of the documented two-step refill)"** | transcript |
| 12:42:28.017 | ⇒ `✘ Failed to uninstall plugin "quay@quay": Plugin "quay@quay" is installed in user scope, not project. **Use --scope user to uninstall.**` | 同上 |
| 12:42:40.108 | 该 agent 改跑 `claude plugin uninstall quay@quay --scope user`，描述 "Uninstall quay plugin at its actual (user) scope to clear the cache entry" | 同上 |
| 12:42:41.048 | ⇒ `✔ Successfully uninstalled plugin: quay (scope: user)` | 同上 |
| **12:42:44.134** | `claude plugin install quay@quay --scope user -y`，描述 **"Reinstall quay plugin at user scope to force a cache refill"** | 同上 |
| 12:42:44.751 | `~/.claude/settings.json` mtime——用户级 `enabledPlugins` 出现 `"quay@quay": true`（tool_use 后 **617ms**） | `stat` |
| 12:42:45.146 | `installed_plugins.json` 新增上述 `scope:"user"` 记录 | 直接读盘 |
| 12:45:34.646 | AC-161 goal gate **fail** `CAUSE=user-enabled-plugins` | `.quay/gate-events.jsonl` |

**排污者身份**：session `9cf007b4-feec-4d83-a2dd-846debf30ce1`，project dir `-home-yale-work-quay-fleet--claude-worktrees-pwa-remove-confirm-dialogs`（quay-fleet，worktree `pwa-remove-confirm-dialogs`），一个常驻观察者会话。

### 能区分两个假设的对照（硬规则 4 推论四）

它**不是自己发明** `--scope user` 的。两个假设：

- **A（排污者自行其是/没照文档做）**：若成立，它的**第一条**命令就不会是文档里那条。
- **B（它照文档做了，而文档的配方在当前机器状态下不可执行，是 CLI 的报错把它改道的）**：唯一与全部读数吻合。

**对照判据（动作级，一条即可区分）**：`12:42:27.085` 那条 tool_use 的**描述文本逐字引用了文档措辞**「step 1 of the documented two-step refill」，而升级到 user scope 发生在 `12:42:28.017` **CLI 报错之后**。⇒ A 被否证，B 成立。**照文档做，正是产生 `--scope user` 的原因。**

**同时排除了「检测坏了」这个备择解释**：下一次 gate 运行（`12:45:34.646`，污染后 **2 分 50 秒**）已经把 verdict 翻成 fail。`goal-round.jsonl` 第 76 轮（record ts `12:43:35.169Z`）仍写 `pass`，只因**它那一轮的 gate 跑在 `12:40:04`**——是**观测窗**，不是陈旧裁决（两读数相差 3 分 31 秒，污染落在窗内）。

### 为什么前四次的修都没守住 / 为什么这次是【第五个、机制全新的】

前四次依次是：①只恢复状态不碰写侧；②只堵脚本自己那一笔 `enabledPlugins` 写入；③只堵 CLI materialization 的默认 `--scope`；④「任何拿着 Bash 的在飞 agent 自己选了 `--scope user`」。

第四次修复的产物是**一条刷新配方**，落在三处（逐字一致）：

- `packages/quay/scripts/register-plugin.mjs:46-70`
- `plugin/scripts/quay-init.sh:2655-2663`
- `plugin/skills/init/SKILL.md:48-58`

三处都写：

```
claude plugin uninstall quay@quay --scope project
claude plugin install   quay@quay --scope project -y
```

并各自附「**never** `--scope user`」/「do NOT reach for `--scope user`」。

**这条配方有一个它自己看不见的缺陷：第一步在「存在 `scope:"user"` 安装记录」时不可执行。** 上面 `12:42:28.017` 的报错就是实测——`claude plugin uninstall --scope project` 在该状态下**直接失败**，而它的**错误信息本身**指示 `--scope user`。⇒ **一个严格照配方做的 agent，会被机器亲手递上配方唯一禁止的那条命令。** 文档说「永远不要 --scope user」，CLI 说「Use --scope user」。**CLI 赢了。**

**而让第一步失败的那个状态，是本仓交付路径自己生产的**：`plugin/scripts/verify-deliver-coldstart.sh:4133` 跑 `claude plugin install "quay@quay" --scope user -y`，用的是操作者**真实 `$HOME`**（`local home="${HOME:-}"`，`:3841`——⛔ 不是段① 隔离的 `STEP1_SEGMENT_HOME`），这是 AC-258 的设计（它的被测对象**就是** user-scope materialization，第四次修复还特意把这里的 `--scope user` 写成**显式**）。而该脚本**全篇没有任何 uninstall/restore**（`grep -c uninstall plugin/scripts/verify-deliver-coldstart.sh` = **0**）⇒ **本机每跑一次真实交付验证，就留下一条常驻 `scope:"user"` 记录**，它同时 (a) 直接打红 AC-161，且 (b) **正是把下一个 agent 改道到 `--scope user` 的那个陷阱**。

⇒ **第四次修复的交付腿，生产了让第四次修复自己的配方失败的状态。** 这是自指缺陷，也是本次为「机制全新的第五个实例」而非重演的原因：**①–④ 是某条通道写了用户级；⑤ 是【照文档做】写出了用户级。**

⚠️ **硬规则 4 推论四——我拿不出 provenance 证据，故不把它当结论**：我在本 workspace 的 `.quay/*.jsonl` 里**没有**找到带 `user_scope_quay_state` 字段的 AC-257/AC-258 产出记录（`grep -rn 'user_scope_quay_state' .quay/*.jsonl` = 0 条），故**无法证明**本次那条既存 user-scope 记录来自 `:4133`。**实测到的是**：(i) `12:42:44` **之前**就存在一条 user-scope 记录（CLI 在 `:28.017` 报错说它在 user scope，且 `:40.108` 的 user-scope uninstall 成功了——两条读数都要求它存在）；(ii) `:4133` 是本机已知唯一的生产者，且它不还原。**本任务必须先补上这个 provenance 读数，而不是照抄上面的因果。**

### 本任务范围

1. 恢复状态（顺序是硬的）；
2. 把刷新配方改成 **scope-complete** 的形态，并**实测**它；
3. 给产生陷阱的那条腿一个裁决（修 ⇒ 附读数；不修 ⇒ 逐字理由 + 「AC-161 与 AC-258 在同一台机器上能否同时为真」的明确读数）；
4. 硬规则 5b 扫描（命中总数 + 前 3 条逐字 + 逐条裁决）。

<!-- dedup-ref -->
**关联任务（不同机制，仅登记，不构成前置）**：`gap-ac161-4th-regression-agent-runs-scope-user-install-to-refresh-a-shared-plugin-cache`（**done**）落的就是本任务要修的那条配方，本任务是它在同一机制面上的后继；`gap-ac161-user-scope-enable-repolluted-by-cli-materialization`（**done**）与 `gap-ac161-postinstall-rematerializes-user-scope-enable`（**done**）分别管脚本直接写与 CLI materialization 默认值，本任务不重开那两条面。**四条均已 done ⇒ 它们不是本任务的重复，是本任务的前提已失效的证据。**

## Plan

1. **按顺序恢复状态**：① **先**逐字读回项目级 `<repo>/.claude/settings.json` 含 `quay@quay`（盘上已在，内容 `{"enabledPlugins":{"quay@quay":true}}`）；② 读回 `installed_plugins.json` 里本仓库那条 `scope:"project"` 记录仍在；③ 确认 `extraKnownMarketplaces.quay.source.path` 仍是 `/home/yale/work/quay/plugin`；④ **最后**从 `~/.claude/settings.json` **删除** `enabledPlugins["quay@quay"]` 这个键。⛔ **不要**用 `claude plugin disable`：它把键置 `false` 而**保留**键，criterion 的 `any('quay' in k …)` 仍命中（09-11 与 09-15 各实测一次 `RC=1`）；⛔ **不要**用任何 `claude plugin install --scope user` 形式。非 quay 键（`meta-cc@meta-cc-marketplace` / `archguard@archguard`）与 `extraKnownMarketplaces`、`model`、`theme` 等逐字保留。
2. **把刷新配方改成 scope-complete（本条要修的根）**。**要求（判据，不锁实现）**：配方必须**先分辨「记录实际在哪个 scope」**，再**始终以 `--scope project` 完成安装**——即形如「在 CLI 报出的实际 scope 上 uninstall（**user-scope uninstall 对 AC-161 无害**：它**删除**键，不是新增）→ `--scope project` install」。**这是假说，必须实测（硬规则 4 推论四），不得直接写进文档**：造一个「共享 cache 由 user-scope 记录持有」的真实状态（hermetic 的一次性 marketplace 插件亦可，照第四次回归的先例），跑修正后的配方，给出三组读数：**cache 被重灌（`payload/dist` 文件数 `0 → >0`）∧ 用户级 `enabledPlugins` **无** quay 键 ∧ AC-161 criterion **exit 0**`**。**若实测证否**（例如 user-scope uninstall 连 cache 一起删、或删掉 user 记录后 `--scope project` install 走别的短路分支），**如实记录实测形态，并给出真正可用的形态**——⛔ 不得把一个没实测过的形态写进三处文档（第四次修复正是因为「按 `--help` 推断未取读数」而当场自我打假过一次）。
3. **给产生陷阱的那条腿一个裁决**：给出读数回答「一次真实交付验证运行之后，用户级 `~/.claude/settings.json` 与 `installed_plugins.json` 各自留下什么」。**已知**：`verify-deliver-coldstart.sh:4133` 用真实 `$HOME` 跑 `--scope user` install，脚本内**零** uninstall/restore。两条可能的闭合（择一，或两条都给读数）：(a) 该腿跑完**恢复**用户级状态（记录 + 还原）；(b) 操作者机器上的该腿改走**隔离 HOME**（段① 已有 `STEP1_SEGMENT_HOME` 先例），只在**目标机**保留真实 HOME 语义。**若两条都不可行**（AC-258 的结构要求），把它**如实登记为观察项**，并给出「AC-161 与 AC-258 在同一台机器上能否同时为真」的明确结论 + 支撑读数——⛔ 不得以未测量的形态占用一个阻塞位（硬规则 12）。
4. **硬规则 5b 扫描**：全仓扫「**教或执行『刷新共享 cache』**」的位置——谓词按位置取（行上调用 `claude plugin uninstall|install` **或**文档里同形的两步块 ∧ 邻近语境含 cache/refresh/刷新），⛔ 排除整行注释与 `test/`。**把命中总数与前 3 条逐字命中贴进结果段**，逐条裁决。已知至少 3 条（`register-plugin.mjs:46-70` / `quay-init.sh:2655-2663` / `plugin/skills/init/SKILL.md:48-58`）。
5. **判据能取假**：见 AC4（修正后配方真的跑过）与 AC5（故意排污 ⇒ 转红）。
6. 把 1–5 的读数（criterion exit code、`settings.json` sha256 前后、取假两半、扫描命中数与前 3 条）写进 `## Result`。

## AC

- [ ] AC1: criterion 原文提取后逐字跑 ⇒ **exit 0**（立案当轮实测 exit 1，`CAUSE=user-enabled-plugins — …: quay@quay`）。贴出 `~/.claude/settings.json` 的 sha256 **前后两组**（立案态 `691eebf7…f2681`）。
- [ ] AC2（**不把自己锁在门外**，顺序纪律）：`<repo>/.claude/settings.json` 的项目级启用**仍在**（`enabledPlugins` 含 `quay@*` 键）∧ `installed_plugins.json` 里本仓库的 `scope:"project"` 记录**仍在** ∧ `~/.claude/settings.json` 的 `extraKnownMarketplaces.quay.source.path` 仍 = `/home/yale/work/quay/plugin`。三条全部逐字贴出，且**删除动作发生在三条读回之后**（有产物：删除前打印的 go/no-go 行）。
- [ ] AC3（配方 scope-complete）：修正后，三处配方（`register-plugin.mjs` / `quay-init.sh` / `plugin/skills/init/SKILL.md`）**不再含**「第一步固定 `--scope project`」这一在 user-scope 记录存在时不可执行的形态，且各自写明**如何分辨记录实际所在的 scope**。给出同一谓词修正前后的命中读数（形如 `uninstall --scope project` 字面命中数 `3 → 0`）。
- [ ] AC4（**能取假**——修正后的配方**真的跑过**，硬规则 4）：造「共享 cache 由 user-scope 记录持有」的真实状态 ⇒ 跑修正后的配方 ⇒ **cache 文件数 `0 → >0`** ∧ **用户级 `enabledPlugins` 无 quay 键** ∧ **criterion exit 0**。三组读数**全部贴出**。⛔ 只在文档里改字而没跑这条 ⇒ 判 AC4 未达成。
- [ ] AC5（**能取假·负控制**）：干净基线上**故意**跑一次 `claude plugin install quay@quay --scope user -y`（操作者真实 HOME）⇒ criterion **exit 1** ∧ 台账尾翻 fail；删键恢复 ⇒ 回到 **exit 0**。**两组读数贴出**（证明判据非空转）。
- [ ] AC6（**产生者有裁决**）：给出读数回答「一次真实交付验证运行后用户级留下什么」，并对 `verify-deliver-coldstart.sh:4133` 给出裁决——修 ⇒ 附「运行后用户级无 quay 键」的读数；不修 ⇒ 附逐字理由 + 「AC-161 与 AC-258 可否同真」的结论与支撑读数。⛔ 不得以未测量的形态登记为阻塞位。
- [ ] AC7（**硬规则 5b 扫描**）：结果段必须含向「刷新共享 cache」这一机制的调用点/文档块的**命中总数**与**前 3 条逐字命中**，且每条有裁决（修 ⇒ 读数 / 不修 ⇒ 逐字理由）。零计数时须附「谓词对一个**已知为真**的样本（`plugin/skills/init/SKILL.md:52` 那一行）干跑命中」的读数（硬规则 2 的零计数配套动作）。
- [ ] AC8（不引入新红）：与本次改动有关的测试全绿；`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` ⇒ **exit 0**（既有 control 不退化，尤其 `MP_ENABLED_LEAK` / `install_scope` 相关项）。⚠️「不产生新红」本身不是接线成功的证据，必须与 AC4/AC5 同读（硬规则 3b）。

## DoD

真实对象被操作过、判据能取假，缺一不可：

- `~/.claude/settings.json` 被**真实编辑过并回读** ⇒ AC-161 criterion 在生产上 **exit 0**（直接读数，不是断言）；
- **修正后的配方真的跑过**：AC4 的三组读数（cache `0→>0` ∧ 无 quay 键 ∧ exit 0）在结果段里。⛔ 只在仓库里改文档而没跑负控制 ⇒ 不算达成（硬规则 4 推论三：只能被夹具满足的判据不是测量）；
- **判据能取假**：AC5 的两半（故意 `--scope user` ⇒ 红；删键恢复 ⇒ 绿）**都真的跑过**并贴出读数；
- **产生者有裁决**：AC6 的读数与裁决在结果段里；
- **扫描有读数**：AC7 的命中总数与前 3 条逐字命中在结果段里（硬规则 5b 的产物——写不出这个数即视为只修了被报出来的那一个）；
- goal-driver 下一轮复跑后，`.quay/goal-round.jsonl` 中 AC-161 的 `verdict` 由 fail 翻 **pass**，且不再出现在 `achievedFailing`。**⚠️ 本条由 goal-driver 的下一轮产生，非本 worker 可观测 ⇒ worker 不作声称**（延续前四次回归任务已被证成的做法）。

⛔ 反序（先删用户级再确认项目级就绪）会把本机锁在「哪里都没有 quay」。
⚠️ **本次排污者立案当轮仍活跃**：session `9cf007b4-…`（quay-fleet / worktree `pwa-remove-confirm-dialogs`）仍在跑，而它的工作正需要反复操作 plugin cache ⇒ **本任务落地后必须复核一次 criterion**；若复现，把那条命令逐字记进结果段，作为**第 6 个实例**。

## Touches

- `packages/quay/scripts/register-plugin.mjs`
- `plugin/scripts/quay-init.sh`
- `plugin/skills/init/SKILL.md`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `plugin/test/verify-deliver-coldstart.test.mjs`
- `README.md`
- `tasks/gap-ac161-5th-regression-refresh-recipe-not-scope-complete.md`
