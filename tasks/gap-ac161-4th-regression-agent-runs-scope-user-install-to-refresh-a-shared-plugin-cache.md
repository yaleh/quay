---
id: gap-ac161-4th-regression-agent-runs-scope-user-install-to-refresh-a-shared-plugin-cache
title: AC-161 第四次回归：在飞 agent 为了刷新跨 scope 共享的 plugin cache 顺手跑 `--scope
  user`——判据只钉在被声明的通道上，于是「任何拿 Bash 的 agent」这条通道从未被覆盖
status: done
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

**问题**：STANDING goal AC-161（GOAL-003，`long-term: true`，status 已 achieved）**第四次失败**——被它保证的事实当前不成立。立案当轮把 `goals/AC-161-user-level-marketplace-only.md` 的 criterion **原文提取后逐字跑**（⛔ 不手抄）：

```
CAUSE=user-enabled-plugins — user-level enabledPlugins still enables quay plugin(s): quay@quay
exit=1
```

**回归时间线（四条独立读数互校，非同形推断）**：

| 时刻 (UTC) | 读数 | 载体 |
|---|---|---|
| 05:51:43.791 | AC-161 verdict=**pass**（goal round 25） | `.quay/goal-round.jsonl` 的 `facts[].value.criteria` |
| 05:53:39.243 | 旧 cache `~/.claude/plugins/cache/quay/quay/0.6.3/` 被写 `.orphaned_at`（被顶替） | 直接读盘 |
| **05:54:09.912** | **在飞 worker**（任务 `gap-ac264-quay-fleet-project-scope-plugin-only-deployment`，pid 2449205，session `4d77ed06-0653-4bc9-9b0b-9e8c843ca584`）跑：`rm -rf /home/yale/.claude/plugins/cache/quay/quay/0.7.0; cd /home/yale/work/quay-fleet && claude plugin install quay@quay --scope user -y --json`，工具描述逐字为 **"Delete stale cache dir and reinstall user scope"** | worker transcript `~/.claude/projects/-home-yale-work-quay/4d77ed06-….jsonl` 的 tool_use 记录 |
| 05:54:10.474 | `~/.claude/settings.json` mtime（`enabledPlugins` 出现 `"quay@quay": true`） | `stat` |
| 05:54:10.738 | `installed_plugins.json` 新增 `quay@quay` `scope:"user"` / `version:"0.7.0"` | 直接读盘 |

**能区分两个假设的对照（硬规则 4 推论四——给不出这个对照就只能降为假说）**：

- **假设 A（第三次的根：postinstall → `register-plugin.mjs` → `claude plugin install` 默认 user）：已被否证。** ① 05:46:12 有一次**真实安装**跑过（`npm install --prefix /tmp/quay-m120-e2e-install-JqpUPl …/quay-0.7.0.tgz`，cwd = ac263 worktree；日志 `~/.npm/_logs/2026-09-15T05_46_12_014Z-debug-0.log`），而 **05:51:43（5 分钟后）的 goal round 仍判 pass**——若 A 成立，那一轮就该已经红。② 逐字读交付脚本确认上一次修复（`86e5c1db4`）**完好在位**：`packages/quay/scripts/register-plugin.mjs` 的 enable 步已是显式 opt-in（`QUAY_PLUGIN_SCOPE` 未设/不可识别 ⇒ 只跑 `plugin marketplace add`，⛔ 不跑 `plugin install`），且那次 install 未带 `-g` ⇒ 脚本在 `npm_config_global` 闸即退出。
- **假设 B（在飞 worker 的显式 `--scope user`）：唯一与四条读数同时吻合**——命令本身、工具描述文本、`settings.json` 的 mtime 与 `installed_plugins.json` 的 user-scope 记录落在**同一秒**，且 cache 目录刚被**同一条命令** `rm -rf` 过（它当前 mtime 05:54:10.732 正是这次重建的那一份）。

**这次是【第四个、与前三次机制都不同】的根**。前三次依次是：①只恢复状态不碰写侧、②只堵脚本自己那一笔写入、③只堵 CLI materialization 的默认。**这一次没有任何一条"被声明"的通道被用到**——是一个**拿着 Bash 的在飞 agent 自己选**了 `--scope user`。

**它为什么会这么选（是机制，不是失误）**：plugin cache 的路径是 `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>`——**按 marketplace+plugin+version 键控、跨 scope 共享**。该 worker 在 05:53:15 已按自己任务的要求跑过 `claude plugin install quay@quay --scope project -y`，随后发现共享 cache 里那份 0.7.0 不完整（缺 `bin/`）⇒ **「刷新这份共享 cache」没有 project-scope-only 的形式**，`--scope user` 是唯一能把它重新灌满的命令 ⇒ 它取了这个顺手解，并在 05:54:15 又切回 `--scope project`。**它不是在做坏事，它是在自己的任务没有覆盖的维度上取了一个局部最优。**

**为什么没有一道闸看见它（这才是本条要修的东西）**：AC-264 自己的 AC **只读 `/home/yale/work/quay-fleet/.claude/settings.json`**（fleet 的项目级），**没有任何判据读 `/home/yale/.claude/settings.json`**（用户级）⇒ 这次排污对**肇事任务自己的门**完全不可见，它照样能绿。而 AC-161 的 criterion 虽然每轮都跑，却**没有阻塞力**，只是把红记进台账。

**为什么前三次的修法都没守住（硬规则 5b：修好一处 ≠ 只此一处；硬规则 12：未决的「产品决策」长期占着阻塞位）**：前三次每一次都只关掉**一条被声明的写通道**；而这次的排污者根本不是通道，**是任何拿着 Bash 的在飞 agent**。第三次修复还**明确把两处同形实例登记为「不动」**：`plugin/scripts/verify-deliver-coldstart.sh:4038` 的 `claude plugin install "quay@quay" -y`（**无 `--scope`，即 CLI 默认 user**），而承载它的函数在 `:3841` 读的是 `local home="${HOME:-}"`，**真实 HOME**，⛔ 不是段① 那个隔离的 `STEP1_SEGMENT_HOME`——于是这条腿今天在**本机**跑一次就会把操作者的用户级打红；同一处 `:4025-4032` 的描述注释也已陈旧（它写的「register-plugin.mjs 自己会调两条 CLI 命令」在修复后已不成立）。**登记而未修 ⇒ 本次回归正是从"没被登记的那条通道"来的。**

## Plan

1. **按顺序恢复状态**（反序 = 把自己锁在门外）：① 确认项目级 `<repo>/.claude/settings.json` 已是 `{"enabledPlugins":{"quay@quay":true}}`（盘上已满足，逐字读回）；② 确认 `installed_plugins.json` 里本仓库那条 `scope:"project"` 记录还在（09-08 起在）；③ **最后**从 `~/.claude/settings.json` **删掉** `enabledPlugins["quay@quay"]`——⛔ **不要**用 `claude plugin disable`：它把键置 `false` 而**不删键**，criterion 的 `any('quay' in k …)` 仍命中，09-11 已实测 `RC=1`；④ 确认 `extraKnownMarketplaces.quay.source.path` 仍是 `/home/yale/work/quay/plugin`（本次回归中它未被污染，回归读数里它是干净的）。跑 criterion ⇒ exit 0。
2. **把判据挪到产物上——让肇事任务自己的门读用户级**（本条要修的根）。**要求（判据，不锁实现）**：plugin 交付渠道那条路的验证产出者（`.quay/productization-verification.jsonl` 的生产者 / `verify-deliver-coldstart.sh` 的 AC-257/AC-258 记录器）在写记录**之前**读用户级 `~/.claude/settings.json`，并把「user 级 `enabledPlugins` 无 quay 键」作为**可核字段**落进记录；**出现即不得静默通过**（硬规则 3b：读不懂/不满足要有一个不同于「合格」的取值）。⛔ **不要**把它做成全库套件级的静态检查——那会让任何**故意**的 user-scope 安装（AC-258 在远端主机上正是被要求的那种）把整个套件打红，等于把「主机态」错当「代码态」。
3. **取假（正/负控制）**：干净基线（AC1 exit 0）上**故意**跑一次 `claude plugin install quay@quay --scope user -y`（操作者真实 HOME）⇒ 第 2 步那个新判据**转红**、且 AC-161 criterion **exit 1**；删键恢复 ⇒ 两者都绿。**两组读数贴进结果段。** ⛔ 只加断言而不跑负控制 ⇒ 不算达成（硬规则 4 推论三：只能被夹具满足的判据不是测量）。
4. **关掉顺手解，或如实报告它关不掉**：该 worker 当时的真实需求是「刷新 `~/.claude/plugins/cache/quay/quay/<version>` 这份**跨 scope 共享**的 cache」。**先给出读数**：project-scope-only 的刷新形式是否存在（`claude plugin update --scope project` 是否真的重灌共享 cache？`claude plugin --help` / `claude plugin update --help` 的实测输出为证）。**存在** ⇒ 把交付/验证路径改走它，并给出「用它刷新后 cache 完整（`scripts/dist/` 文件数 > 0）∧ user 级键未出现」的读数；**不存在** ⇒ 这是**产品面缺口**，如实登记为观察项（附实测输出作证据），⛔ 不得凭空立一个阻塞位。
5. **硬规则 5b 扫描**：全仓扫「会对**真实 `$HOME`** 写 user-scope 启用」的调用点——**把命中总数与前 3 条逐字命中贴进结果段**，逐条给裁决（修 ⇒ 附读数；不修 ⇒ 附逐字理由）。已知至少两条：`plugin/scripts/verify-deliver-coldstart.sh:4038`（隐式 user 默认 + 真实 HOME，第三次修复登记未修）、以及**本次顺手解所属的那一类**（任何 `claude plugin install` 不带 `--scope`）。⚠️ 零计数时按硬规则 2 的配套动作：把谓词对一个**已知为真**的样本干跑一次（本次已知真样本 = 上面那条 `:4038`），证明谓词能命中它。
6. 把 1–5 的读数（criterion exit code、`settings.json` 前后 sha256、取假两半的读数、扫描命中数与前 3 条）写进 `## Result`。

## AC

- [x] AC1: 把 `goals/AC-161-user-level-marketplace-only.md` 的 criterion **原文提取后逐字跑** ⇒ **exit 0**（立案当轮实测 exit 1，`CAUSE=user-enabled-plugins — …: quay@quay`）。
- [x] AC2（**不把自己锁在门外**，顺序纪律）：`<repo>/.claude/settings.json` 的项目级启用**仍在**（`enabledPlugins` 含 `quay@*` 键）∧ `installed_plugins.json` 里本仓库的 `scope:"project"` 记录**仍在** ∧ `~/.claude/settings.json` 的 `extraKnownMarketplaces.quay.source.path` 仍 = `/home/yale/work/quay/plugin`。三条全部读得出，逐字贴出。
- [x] AC3（**判据挪到产物上**）：第 2 步的验证产出者在**同一条记录**里带上一个可核字段/断言，取值为「用户级 `~/.claude/settings.json` 的 `enabledPlugins` 无 quay 键」——即它与记录**同时产生**，⛔ 不是在另一个文件里另写一遍。
- [x] AC4（**能取假**）：干净基线（AC1 exit 0）⇒ 故意跑一次 `claude plugin install quay@quay --scope user -y`（操作者真实 HOME）⇒ AC3 的那个判据**转红** ∧ AC-161 criterion **exit 1**；删键恢复 ⇒ 两者都绿。**两组读数贴出。** ⛔ 若该判据在两种状态下取值相同 ⇒ 判 AC4 未达成（空转判据）。
- [x] AC5（**顺手解**）：给出读数回答「project-scope-only 的共享 cache 刷新形式是否存在」：存在 ⇒ 交付/验证路径改走它，并给出「刷新后 cache 完整 + user 级键未出现」的读数；不存在 ⇒ 登记为观察项并附 `claude plugin --help` / `claude plugin update --help` 的实测输出作证据。
- [x] AC6（**硬规则 5b 扫描**）：结果段必须含向真实 `$HOME` 写 user-scope 启用的调用点扫描的**命中总数**与**前 3 条逐字命中**，且每条有裁决（修 ⇒ 读数 / 不修 ⇒ 逐字理由）。零计数时须附「谓词对已知真样本 `verify-deliver-coldstart.sh:4038` 干跑命中」的读数。
- [x] AC7（不引入新红）：与本次改动有关的测试全绿（至少 `plugin/test/verify-deliver-coldstart.test.mjs`）；`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` ⇒ exit 0（既有 control 不退化，尤其 `MP_ENABLED_LEAK` 与 `install_scope` 相关项）。⚠️「不产生新红」本身不是接线成功的证据，必须与 AC3/AC4 同读。

**逐条读数 → `## Result` 段。**

## DoD

真实对象被操作过、判据能取假，缺一不可：

- `~/.claude/settings.json` 被**真实编辑过并回读**——AC-161 criterion 在生产上 **exit 0**（直接读数，不是断言）；
- **判据挪到了产物上且能取假**：AC4 的两半（故意 `--scope user` ⇒ 红；删键恢复 ⇒ 绿）**都真的跑过**并贴出读数。⛔ 只在仓库里加断言而没跑负控制 ⇒ 不算达成；
- **扫描有读数**：AC6 的命中总数与前 3 条逐字命中在结果段里（硬规则 5b 的产物，写不出这个数即视为只修了被报出来的那一个）；
- goal-driver 下一轮复跑后，`.quay/goal-round.jsonl` 中 AC-161 的 `verdict` 由 fail 翻 **pass**，且不再出现在 `achievedButFailing`。**⚠️ 本条由 goal-driver 的下一轮产生，非本 worker 可观测 ⇒ worker 不作声称**（延续上一次回归任务已被证成的做法）。

⛔ 反序（先删用户级再确认项目级就绪）会把本机锁在「哪里都没有 quay」。
⚠️ **本次排污者立案当轮仍在飞**：`gap-ac264-quay-fleet-project-scope-plugin-only-deployment`（ready，pid 2449205），而它的工作正需要反复操作 plugin cache ⇒ **本任务落地后必须复核一次 criterion**；若复现，把该 worker 的那条命令逐字记进结果段，作为第 5 个实例。

## Touches

- `plugin/scripts/verify-deliver-coldstart.sh`
- `plugin/test/verify-deliver-coldstart.test.mjs`
- `packages/quay/scripts/register-plugin.mjs`
- `plugin/scripts/quay-init.sh`
- `plugin/skills/init/SKILL.md`
- `README.md`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-ac161-4th-regression-agent-runs-scope-user-install-to-refresh-a-shared-plugin-cache.md`
- `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`

## Result

### AC1 — criterion 原文提取后逐字跑 ⇒ `exit 0`

提取方式：PyYAML 解 `goals/AC-161-user-level-marketplace-only.md` frontmatter 的 `criterion`（折叠块），把该字符串**逐字**交给 `bash`（⛔ 不手抄，⛔ 不朴素 join）。

| 状态 | `~/.claude/settings.json` sha256 | 生产 predicate | criterion |
|---|---|---|---|
| 立案后（回归遗留，未修） | `691eebf7e7c208c35d4d5c93e8708c389dd720f819bae2354694b142ef6f2681` | `present:quay@quay`（exit 1） | **exit 1** — `CAUSE=user-enabled-plugins — user-level enabledPlugins still enables quay plugin(s): quay@quay` |
| 修复后（删键） | `95fa671441dc7919cdc7a1a40c8f69a0bc8081ba84edc67fee388760918c9661` | `absent`（exit 0） | **exit 0** |

生产路径同读数：`node --experimental-strip-types packages/quay/bin/quay.ts goal gate AC-161 --store --root /home/yale/work/quay` ⇒ `"reason": "acceptance passed (exit 0)"`，exit 0。

旁证：回归遗留文件的 mtime = `2026-09-15 05:54:10.474946254 +0000`，与立案正文引用的 `05:54:10.474` **逐字吻合**（同一把证据）。

删的是**一个键**（`enabledPlugins["quay@quay"]`），⛔ 不是 `claude plugin disable`（它把键置 `false` 而**保留**键 ⇒ criterion 的 `any('quay' in k …)` 仍命中）。非 quay 键 `meta-cc@meta-cc-marketplace` / `archguard@archguard` 逐字保留。

### AC2 — 不把自己锁在门外（三条读数，最终态逐字）

```
① /home/yale/work/quay/.claude/settings.json
   { "enabledPlugins": { "quay@quay": true } }

② installed_plugins.json 里本仓库那条 scope:"project" 记录
   {"scope": "project", "projectPath": "/home/yale/work/quay",
    "installPath": "/home/yale/.claude/plugins/cache/quay/quay/0.6.1", "version": "0.6.1",
    "installedAt": "2026-09-08T18:09:24.295Z", "lastUpdated": "2026-09-08T18:09:24.295Z"}

③ 用户级 extraKnownMarketplaces.quay.source.path
   /home/yale/work/quay/plugin
```

**顺序纪律有产物**：删除**之前**逐条读回并 assert ①②③（② 非空 ∧ ③ 逐字相等 ∧ ① 含 `quay@quay`），三条全绿才执行删除（脚本输出 `YES — safe to drop the user-level key`）。

### AC3 — 判据挪到产物上：**同一条记录**里带可核字段

`plugin/scripts/verify-deliver-coldstart.sh` 新增产品函数 **`ac161_user_scope_quay_state()`**，三取值：

```
absent                — 文件可读 ∧ enabledPlugins 无 quay 键      （命题为真）
present:<quay键>      — 文件可读 ∧ 有 quay 键                      （命题为假）
unreadable:<原因>     — 读不到/解析不了/非对象                     （无法评估，⛔ 与两者都不同形）
```

交付渠道的**两个**记录写手（`write_ac257_record` / `write_ac258_record`）在**落盘之前**调用它，读数经 `ac161_user_scope_fragment()` 作为**变量尾**合进**同一条记录**。（`AC161_SETTINGS_PATH` 是 `--selfcheck` 的注入缝；产品路径不设它 ⇒ 读操作者真实 `$HOME`。）

**真实写手 + 把落盘点替换成 echo ⇒ 记录体逐字**（⛔ 不是复刻判定逻辑，是驱动产品函数）：

```
=== 干净用户级 ⇒ 记录写出，且携带字段 ===
  "ac":"GOAL-018-AC-257"
  "user_scope_quay_state":"absent"
=== 用户级有 quay 键 ⇒ 一条都不写 ===
AC161-USER-SCOPE: GOAL-018-AC-257 record refused — state=present:quay@quay — user-level ~/.claude/settings.json enabledPlugins still carries a quay key; this record's project-scope premise is FALSE → nothing written (standing goal AC-161)
  （无 RECORD-FRAGMENT 行 ⇒ 零条记录）
```

两条 AC 的语义分界（**有意为之**，非疏漏）：

- **AC-257 拒写** —— 它宣称的是 **project scope** 的合并语义；用户级有 quay 键时该前提为假。
- **AC-258 照写并记录** —— 它测的就是 **user scope**，终态**要求** `installed_plugins.json` 里有一条 `scope:"user"` 条目；若在这里按「无 quay 键」拒写，该 AC 会**结构上不可满足**（正是正文 ⛔ 警告的「把主机态错当代码态」）。它的记录携带 `"user_scope_quay_state":"present:quay@quay"`。
- 两者都对 `unreadable:*` **拒写**（读不懂 ≠ 合格，硬规则 3b），但报错**不同形**（`state=unreadable:*`）。

⛔ 未做成全库套件级静态检查。字段经**变量尾**写入 ⇒ `--ac-record-schema-report` 对 AC-257/AC-258 仍打 `[ok] criterion=11 schema=11 writer=11`（复用 AC-238 先例：该字段无 criterion 消费者，而 AC-161 的 criterion 是 achieved 判据、⛔ 不可改）⇒ AC7 的既有 control 不退化。

### AC4 — 能取假（两组读数，都在**操作者真实 HOME** 上跑）

| 步骤 | `~/.claude/settings.json` sha256 | 生产 predicate | 真实 `write_ac257_record`（真 HOME） | criterion |
|---|---|---|---|---|
| 干净基线 | `95fa6714…c9661` | `absent` exit 0 | ✅ 通过 AC-161 闸并**走到落盘点**（harness 里报 `ac_record_append: command not found` ⇒ 证明闸**不是恒拒**） | **exit 0** |
| 故意 `claude plugin install quay@quay --scope user -y` | `691eebf7…f2681` | `present:quay@quay` exit 1 | ⛔ **拒写** `state=present:quay@quay`，rc=1，**零条记录** | **exit 1** |
| 删键恢复 | `95fa6714…c9661` | `absent` exit 0 | ✅ 再次走通 | **exit 0** |

刻意跑的那条命令（cwd 为一次性目录）：

```
$ claude plugin install quay@quay --scope user -y
Installing plugin "quay@quay"...✔ Successfully installed plugin: quay@quay (scope: user)
```

**双向逐字节互证**：故意安装后的文件 sha **等于**立案时回归遗留的那一份（`691eebf7…`）；删键后的 sha **等于**立案前干净的那一份（`95fa6714…`）。⇒ 不是「断言能取假」，而是**同一条命令、同一份字节**在两种状态下取值相反 ⇒ **判据非空转**。

### AC5 — 顺手解：project-scope-only 的共享 cache 刷新形式**存在**，但不是 `plugin update`

`claude plugin --help` / `claude plugin update --help` 实测：`update` 有 `-s, --scope <scope>`，取 `user|project|local|managed`（默认 user）⇒ **CLI 表层存在 project-only 形式**。但**实测它不重灌共享 cache**。用一次性目录 marketplace 插件（`ac161probe`，与 quay 无关、hermetic）在 project scope 安装后**故意删掉 cache 里的 `payload/dist`**，再逐条测：

| 命令（都在 project scope） | cache `payload/dist` 文件数 |
|---|---|
| 故意破坏后（基线） | **0** |
| `claude plugin update <ref> --scope project -y` | **0** — 输出 `already at the latest version`，短路，**未重灌** |
| `claude plugin install <ref> --scope project -y`（重装） | **0** — 输出 `already installed`，同样短路 |
| `claude plugin uninstall <ref> --scope project` **+** `claude plugin install <ref> --scope project -y` | **1** ✅ 重灌成功，且**用户级 `enabledPlugins` 未新增任何键** |

⇒ **答案：存在——是同 scope 的 uninstall+install 两步，不是 `plugin update`。**

**交付/验证路径已改走它**：`packages/quay/scripts/register-plugin.mjs` 的 REFRESH 段与其无 `enableScope` 分支的提示、`plugin/scripts/quay-init.sh` 的打印步骤、`plugin/skills/init/SKILL.md` 全部写成实测的两步形，并逐字记下「`update`/重装都会短路」这个反直觉读数。整轮实验后 AC-161 criterion 仍 **exit 0**，实验载体（scratch 插件、缓存、marketplace、项目记录）**已全部清除**（残留 grep 计数 = 0）。

⚠️ **我在这里犯过一次硬规则 4c 并被自己的读数打假**：第一版文档写的是 `claude plugin update --scope project`（我按 `--help` **推断**而未取读数）——实测 0→0。已按实测改正（提交 `b0faa82b0`）。

### AC6 — 硬规则 5b 扫描（命中总数 + 前 3 条逐字 + 逐条裁决）

**谓词（按位置，硬规则 2）**：行上**调用** CLI 的 enable 动词（shell 形 `claude plugin install|update|enable`，或 node 形 `runCli([…"plugin"…"install"…])`）∧ ⛔ 排除整行注释（`#` / `//`）∧ ⛔ 排除 `test/`（夹具用假 `claude`）。
**谓词干跑（硬规则 2 的配套动作）**：对**已知真样本**（修复前的 `verify-deliver-coldstart.sh:4038` 逐字行）**命中**；对**已知假样本**（`echo "  claude plugin install quay@quay"`）**正确丢弃**。

**Tier A — 会执行的调用点：修复前共 4 条，其中 2 条 UNGUARDED**（`git grep … develop`，前 3 条逐字）：

```
1. develop:packages/quay/scripts/register-plugin.mjs:207:    const install = runCli(["plugin", "install", pluginRef, "--scope", enableScope]);
2. develop:plugin/scripts/quay-init.sh:2648:  claude plugin install quay@quay
3. develop:plugin/scripts/verify-deliver-coldstart.sh:3711:    (cd "$root" && claude plugin install quay@quay --scope project -y) >/dev/null 2>&1
   （第 4 条，本次立案点名的已知真样本）
4. develop:plugin/scripts/verify-deliver-coldstart.sh:4038:      claude plugin install "quay@quay" -y >>"$home/ac258-cli-materialize.log" 2>&1
```

逐条裁决：

1. `register-plugin.mjs:207` — **不修（非缺陷）**：`--scope enableScope` 显式，且整条调用被 `QUAY_PLUGIN_SCOPE` 显式 opt-in 闸住（未设 ⇒ ⛔ 不跑 `plugin install`）。它周边两处**陈述陈旧**（称 hook 会写用户级 `enabledPlugins`）⇒ 已改（见下）。
2. `quay-init.sh:2648` — **修**：无 `--scope` ⇒ CLI 默认 **user**；它是**打印给 agent 照抄**的步骤 ⇒ 改 `--scope project`（现 `:2649`），并补一条「⛔ 总要写 `--scope`」的说明。
3. `verify-deliver-coldstart.sh:3711` — **不修（非命中）**：`--scope project` 显式。
4. `verify-deliver-coldstart.sh:4038` — **修**（立案点名的、第三次修复**登记未修**的那条）：无 `--scope` ⇒ CLI 默认 **user**，而它的 `home` 是 `local home="${HOME:-}"`（`:3841`，**真实 HOME**，⛔ 不是段① 隔离的 `STEP1_SEGMENT_HOME`）⇒ 现为 `--scope user` **显式**（`:4133`），并把 `:4122-4132` 那段自第三次修复后已不成立的注释逐字订正。**「靠默认值表达意图」本身就是缺陷类**：CLI 默认一旦改动，命令行 / 日志 / 记录**全看不出变化**。

⇒ 另加**结构性控制**（selfcheck，对本脚本自扫）：**每一条会执行的** `claude plugin install|update` 必须显式带 `--scope`，且谓词对已知真样本干跑命中：
`ac161(explicit-scope, positional) executed-calls=2 with-scope=2 probe-known-true-sample=1 unscoped=''`

**Tier B — 无 `scope` 的「安装指令」（agent 会照抄到真实 `$HOME` 上）：修复前 2 条**（分发面文件）：

```
develop:plugin/scripts/quay-init.sh:2648:  claude plugin install quay@quay
develop:plugin/skills/init/SKILL.md:42:claude plugin install quay@quay
```

两条均 **修**（`--scope project` + 「⛔ 总要写 `--scope`，默认是 user」的说明）；修后同一谓词命中 **0**（该类闭合）。
另有 `README.md:106` 的**陈述**「hook … enables it via `enabledPlugins["quay@quay"]`」自第二次修复起即**不成立**，已改为「只注册 marketplace 源 + enable 是 opt-in」；`README.md:120` / `README.md:191` / `plugin/README.md:9` 的 `/plugin install quay` 是**会话内斜杠命令**（scope 由人在会话里选）⇒ **不修**。

### AC7 — 不引入新红

- `bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` ⇒ **exit 0**。既有 control 逐字不退化，尤其 `marketplace-enabled-leak(AC-161违反) MP_SETTINGS_OK=0 MP_ENABLED_LEAK=1`、`ac257(every-field-enforced) declared=11 each_omitted_refused=11`、`ac258(every-field-enforced) declared=11 each_omitted_refused=11`，以及 `--ac-record-schema-report` 的 `GOAL-018-AC-257 [ok] criterion=11 schema=11 writer=11` / `GOAL-018-AC-258 [ok] …`。
- `node --test plugin/test/verify-deliver-coldstart.test.mjs` ⇒ **31/31 pass**（本次新增 3 条）；`plugin/test/quay-init.test.mjs` ⇒ 14/14；`packages/quay/test/npm-pack-e2e.test.mjs` ⇒ 11/11。
- **pre-merge**：`git merge --no-edit develop` 成功、无冲突、未触及本次六个文件（merge commit `9f708fd98`）。
- **scoped 门**（fan-in 同一条命令 `scripts/test.sh --for-task … --allow-thin`）：见下「scoped 门」小节。
- 静态门首跑红了一条并已按机制修：`quay-init-closure-ratchet-stale`（编辑 `quay-init.sh` 的 laydown **源** ⇒ 指纹陈旧）。按该工具自己的文档 `--reanchor` 重锚；**shrink-only 不变量未动**——真实 laydown 仍是 `3 files / 1022 bytes`（与提交基线逐字节相同），基线 diff 只有 `fingerprint` + `quay-init.sh` 的 sha。

### scoped 门

```
bash scripts/test.sh --for-task gap-ac161-4th-regression-agent-runs-scope-user-install-to-refresh-a-shared-plugin-cache --allow-thin
⇒ GATE_EXIT=0
```

（首跑 `GATE_EXIT=1`，唯一红点是 `quay-init-closure-ratchet-stale`；re-anchor 后复跑转绿。）

### 第 5 个实例观察（⛔ 不作阻塞位）

立案当轮在飞的 `gap-ac264-quay-fleet-project-scope-plugin-only-deployment` 仍存在 worktree、仍有 worker 进程；本任务执行期间与收尾时**复核 criterion 均为 exit 0**（`~/.claude/settings.json` sha 稳定在 `95fa6714…`，predicate = `absent`），**未复现** ⇒ 尚无第 5 个实例可记。该 worker 的任务正需要反复操作 plugin cache，故本条的**新闸**（AC-257 记录在用户级有 quay 键时拒写 + AC-161 criterion 每轮跑）是它下次排污时的可见面。

### 补充（2026-09-15，fan-in 全量套件红 ⇒ 已修）—— ⑥ shipped-set closure 的陈旧字面量

fan-in 全量套件 `# fail 1`，唯一红点 `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs:137`：
`assert.match(r.stdout, /empty-list → violations=5 \(expect ≥1/)`，实测 **6**。

**机械 delta-relatedness 判它 UNRELATED 是错的**（与 `e357db3ad` 同形、同一文件、同一根因类）：该断言不 import 任何东西，
它 `spawnSync` 跑 `develop-deliver-tgz.sh --selfcheck-transport-closure`，而后者**读 shell 脚本文本**抽取
「消费者 `verify-deliver-coldstart.sh` 引用的 `$SCRIPT_DIR` 兄弟」（`sed '/^selfcheck() {/,/^}$/d' | grep -oE '…\.(ts|mjs|js|sh)'`）
⇒ 一跳 import 检查结构上看不见这条依赖。**worktree 内当场复现（6 ≠ 5）⇒ 真因，非环境噪声。**

**根因**：本任务 AC6 的结构性控制引入 `local ac161_self="$SCRIPT_DIR/verify-deliver-coldstart.sh"`（`verify-deliver-coldstart.sh:8234`），
消费者引用集 5 → 6。⛔ **不是脚本的缺陷**：该文件确实在 `transport_flat_files()` 中，被点名是**正确**行为
（`positive → violations=0` 未变）；陈旧的只是测试里的字面量。

**修法（照 `e357db3ad` 先例：推导，⛔ 不写字面量）**：期望值改为**由消费者的实际引用集推导** ——
JS 侧独立镜像同一段 `sed` 范围删除与同一正则，断言 `violations == |refs|`。
两个**独立实现**（shell 的 sed/grep vs JS）读同一个消费者 ⇒ 这是测量而非回声（硬规则 4），
且**新增兄弟引用时测试无需改动**。

**取假控制（两组，均在本 worktree 当场跑）**：

```
控制 A（反陈旧 —— 证明它不再是字面量）：脚本尾部加一行
  # control probe (temporary): ${SCRIPT_DIR}/repo-root.ts
  ⇒ 消费者引用 6 → 7，测试**零改动仍绿**（旧字面量 5、或把 5 改成 6 的写法，都会红）

控制 B（能取假 —— 证明它真的在比对）：再把 develop-deliver-tgz.sh:427 的抽取正则
  \.(ts|mjs|js|sh)  →  \.(ts|mjs|js)
  ⇒ shell 报 6 / JS 报 7 ⇒ 新断言转红，判词点名推导集：
  `the empty-list violation count must equal the CONSUMER's own sibling references (7: pane-state-classify.ts, provider-binding-resolvability-check.ts, quay-init-closure-assertion.ts, repo-root.ts, runner-state-write.ts, verify-deliver-coldstart.sh, write-json-atomic.ts)`
```

两个临时改动均已 `git checkout --` 还原（还原后 `git status` 仅剩本测试文件一处 `M`）。
修复后 `node --test plugin/test/develop-deliver-tgz-evidence-transport.test.mjs` ⇒ **19/19 pass**。
`## Touches` 已补 `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`（同一改动面：改了消费者引用集，钉住该面的守卫必须随之更新）。