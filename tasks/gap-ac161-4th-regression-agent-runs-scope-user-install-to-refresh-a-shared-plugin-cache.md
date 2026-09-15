---
id: gap-ac161-4th-regression-agent-runs-scope-user-install-to-refresh-a-shared-plugin-cache
title: AC-161 第四次回归：在飞 agent 为了刷新跨 scope 共享的 plugin cache 顺手跑 `--scope
  user`——判据只钉在被声明的通道上，于是「任何拿 Bash 的 agent」这条通道从未被覆盖
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

- [ ] AC1: 把 `goals/AC-161-user-level-marketplace-only.md` 的 criterion **原文提取后逐字跑** ⇒ **exit 0**（立案当轮实测 exit 1，`CAUSE=user-enabled-plugins — …: quay@quay`）。
- [ ] AC2（**不把自己锁在门外**，顺序纪律）：`<repo>/.claude/settings.json` 的项目级启用**仍在**（`enabledPlugins` 含 `quay@*` 键）∧ `installed_plugins.json` 里本仓库的 `scope:"project"` 记录**仍在** ∧ `~/.claude/settings.json` 的 `extraKnownMarketplaces.quay.source.path` 仍 = `/home/yale/work/quay/plugin`。三条全部读得出，逐字贴出。
- [ ] AC3（**判据挪到产物上**）：第 2 步的验证产出者在**同一条记录**里带上一个可核字段/断言，取值为「用户级 `~/.claude/settings.json` 的 `enabledPlugins` 无 quay 键」——即它与记录**同时产生**，⛔ 不是在另一个文件里另写一遍。
- [ ] AC4（**能取假**）：干净基线（AC1 exit 0）⇒ 故意跑一次 `claude plugin install quay@quay --scope user -y`（操作者真实 HOME）⇒ AC3 的那个判据**转红** ∧ AC-161 criterion **exit 1**；删键恢复 ⇒ 两者都绿。**两组读数贴出。** ⛔ 若该判据在两种状态下取值相同 ⇒ 判 AC4 未达成（空转判据）。
- [ ] AC5（**顺手解**）：给出读数回答「project-scope-only 的共享 cache 刷新形式是否存在」：存在 ⇒ 交付/验证路径改走它，并给出「刷新后 cache 完整 + user 级键未出现」的读数；不存在 ⇒ 登记为观察项并附 `claude plugin --help` / `claude plugin update --help` 的实测输出作证据。
- [ ] AC6（**硬规则 5b 扫描**）：结果段必须含向真实 `$HOME` 写 user-scope 启用的调用点扫描的**命中总数**与**前 3 条逐字命中**，且每条有裁决（修 ⇒ 读数 / 不修 ⇒ 逐字理由）。零计数时须附「谓词对已知真样本 `verify-deliver-coldstart.sh:4038` 干跑命中」的读数。
- [ ] AC7（不引入新红）：与本次改动有关的测试全绿（至少 `plugin/test/verify-deliver-coldstart.test.mjs`）；`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` ⇒ exit 0（既有 control 不退化，尤其 `MP_ENABLED_LEAK` 与 `install_scope` 相关项）。⚠️「不产生新红」本身不是接线成功的证据，必须与 AC3/AC4 同读。

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
- `tasks/gap-ac161-4th-regression-agent-runs-scope-user-install-to-refresh-a-shared-plugin-cache.md`
