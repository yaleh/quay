# 规格：Claude Code plugin 全生命周期——单一 bundle、原生交付、安装只写配置（人 2026-09-02）

**性质**：架构裁定 + 落地契约。覆盖开发 → build → 分发 → 部署 → （其它主机其它项目）实际应用。
**正本关系**：本文件只定**形态与判据**；build/版本/发布的既有机制已达标，**指针在第 3 节，不在此处复制**。

## 1. 人的裁定（2026-09-02，逐字）

1. 「**quay-init 复制 Claude Code 的各种扩展文件的行为应当废弃，这是非常糟糕的实践。**」
2. 「对于同一功能，**本项目自己使用的扩展应当与产品交付的是同一个**。不应有所谓『简化版用于产品交付』的情况。」
3. 「可以使用**配置文件**或（**非常克制的**）**文件指针**提供项目配置。」
4. （对本规格第 8 节遗留问题的裁定）「**manager 是产品一部分。**」
5. 「**本项目的开发环境不应污染本机其它项目**」——「**仅允许 User Scope 以本项目目录为 plugin marketplace 源**」（详见 §4b）。
6. 「**quay-init 过程应进一步简化。其主要操作应当是创建符合 quay 要求的项目文件（任务目录、quay 配置等），
   而不应该复制这些 Claude Code 扩展或脚本。**」（详见 §6）

## 2. 这不是新方向，是同一条线的下一步

`orchestration/SPEC-no-text-substitution-at-install.md`（人 2026-08-03，原话「它们是错的，太脏了。
当 quay 升级时，这些在本地被修改过的文件是无法维护的」）**已经禁掉了「复制时改写内容」**，
理由是：**升级时无法判定一个文件为什么与产物不同**（替换改的？使用者改的？两者文件系统上同形）
⇒ 唯一安全动作是跳过 ⇒ **升级静默不生效、而从外面看装得好好的**。

**本规格禁掉的是复制本身**，根因完全相同、只是更靠上一层：
**只要存在副本，就存在「副本与正本不同」这个状态，就需要一套机器去判定该不该覆盖。**
`quay-init.sh` 2000+ 行里很大一部分（managed/conflict/stale 三态、byte-identical 断言、
谁改过的判定）**存在的唯一理由就是管理复制制造出来的漂移**。
⇒ **废除复制是净减法：被删掉的不只是复制动作，还有那整套判定机器。**

## 3. 决定性事实（2026-09-02 实测 + 官方文档双证）

### 3a. 插件能原生交付什么（文档）

| 组件 | 位置 | 命名空间 | 现状 |
|---|---|---|---|
| skills | `skills/<name>/SKILL.md` | `quay:<name>` | ✅ 已用 14 个 |
| agents | `agents/*.md` | `quay:<name>` | ⚠️ 仅 1 个且是死物（§6） |
| **workflows** | `workflows/*.js` | `quay:<name>` | ✅ **已在用，见 3b** |
| MCP server | `.mcp.json` | `mcp__plugin_quay_quay__*` | ✅ 已用 |
| hooks | `hooks/hooks.json` | — | ❌ 未用（`plugin/hooks/` 不存在） |
| scripts | `scripts/` | — | ✅ 309 个；**T1 已实测：`${CLAUDE_PLUGIN_ROOT}/scripts/x` 在 skill 载入时展开为绝对路径 ⇒ 零复制直调成立**（§9） |
| **bin** | `bin/` → **进 Bash 的 PATH** | — | **T4 已实测：PATH 中已存在 `<plugin-root>/bin`（该目录尚不存在也照样在）** ⇒ 建目录即可让 CLI 免 npm 全局安装 |
| settings | `settings.json` | 仅 `agent`/`subagentStatusLine` 两键 | 未用 |

**送不到的只有三样**（必须落在消费项目自己的配置里）：
**① permission allow 规则**（插件不能贡献，文档明确）、**② 插件启用本身**、**③ 项目特有 env/配置**。
⇒ **这三样恰好就是裁定 3 允许的「配置文件」那一层。范围吻合，不是巧合——它是这条架构的天然边界。**

### 3b. 实测：workflows 早就在被原生交付，复制从来不是必要的

```
plugin/.claude-plugin/plugin.json   无 workflows 键
本会话 skill 列表                    quay:fan-in-execute / quay:execute-suite-fix /
                                    quay:pool-quality-judge  ← 全部在列
同一列表                             裸名 fan-in-execute / execute-suite-fix ...  ← 也在列
```
⇒ **`plugin/workflows/*.js` 按约定自动发现并以 `quay:` 暴露，无需声明**；
⇒ **而 `.claude/workflows/` 的那 5 份副本构成第三处双注册**（前两处：MCP 工具名、skills）。
⇒ **「复制 workflows」这件事从未提供任何能力，只提供了一份会漂移的副本。**

**⚠️ 证据来源的一处限定（2026-09-02 补，避免被误引）**：本条的证据是**会话自身的 skill 列表**
（5 个 `quay:` 前缀项与 `plugin/workflows/` 的 5 个文件精确对应；6 个裸名项与 `.claude/workflows/`
的 6 个精确对应）。**`claude plugin details quay` 的组件账本里没有 workflows 这一行**
（它只列 Skills/Agents/Hooks/MCP servers/LSP servers）⇒ **不要引用该账本来支持本条**。
同一账本还报 `Agents (0)`，而 `plugin.json` 声明了 `baime-iteration-executor`
且该 agent 类型在会话中可见——**账本与实际可用面存在已知出入，只可作旁证不可作正本。**

### 3c. `allowed-tools` 语义（查证结论，决定 §7 的一条改造）

**精确字符串匹配，无前缀别名**：`mcp__quay__x` 与 `mcp__plugin_quay_quay__x` 永远是两个名字，
插件内 skill 引用裸名「never fires」（文档原话）。
**但它是软预批准、不是能力限制**：没匹配上 ⇒ 退回正常权限确认，**不是功能失效**。
**实测本仓库现状**：`plugin/skills/{loop-driver,routines}/SKILL.md` 的 `allowed-tools` 写的是裸名
`mcp__quay__*`，而 `quay-init.sh` **全文不写任何 `.mcp.json`**（grep 零命中）
⇒ **正确 onboard 的下游项目里只有 `mcp__plugin_quay_quay__*`**
⇒ **那份裸名单对任何受支持渠道都不生效**，只在本开发机被多余的 root `.mcp.json` 意外兜住。

## 4. 终局形态

```
plugin/                     唯一扩展载体（git 跟踪，一棵树）
  skills/                   本项目自己用的 = 交付的，同一份，无简化版（裁定 2）
  workflows/                含 manager-tick-core.js（裁定 4）
  agents/
  scripts/                  309 个，不复制到消费项目（调用方式见 T1）
  .mcp.json                 → mcp__plugin_quay_quay__*（唯一 MCP 命名空间）
  vendor/quay/dist/*.js     gitignored，sync-vendor.sh 生成（已达标，不动）
```

**本项目自己 = 通过插件机制消费自己**（directory marketplace 指向本仓库 `plugin/`，已是现状）。
**其它项目 = 装同一个 bundle。**
⇒ **两边看到的 skill 名、工具名完全同形** ⇒ 裁定 2 由机制保证，不靠纪律维持
⇒ 且 `allowed-tools` 只剩一种正确写法（§7-2）。

## 4b. 作用域：开发环境不得污染本机其它项目（裁定 5）

**实测的污染（2026-09-02，非推断）**：在 `/home/yale`（**不是** quay 项目）起一个会话，
其 `PATH` 中含 **`/home/yale/work/quay/plugin/bin`，且出现两次**。
⇒ **本仓库的插件面正被注入到本机每一个项目的每一个会话**：`bin/` 进 PATH、14 个 skill 常驻
（实测 ~2,706 tok/会话）、MCP server 起进程。**开发一个项目的代价被摊到了所有项目头上。**

**机制根因**：`~/.claude/settings.json` 的 `enabledPlugins["quay@quay"] = true` 是**用户级启用**，
对本机所有项目无条件生效。（该条目由 npm 全局安装的 `register-plugin.mjs` postinstall 自动写入，
或手工 `claude plugin install` 写入——**不是有意为之的全局化，是安装路径的默认副作用**。）

**裁定形态（人 2026-09-02）——两件事必须分开放**：

| 放什么 | 放哪 | 为什么必须是这一层 |
|---|---|---|
| **marketplace 源**（`extraKnownMarketplaces.quay` → directory `/home/yale/work/quay/plugin`） | **User Scope**（`~/.claude/settings.json`） | 它是**机器特定的绝对路径**，不可提交进仓库；且必须先"可见"才谈得上安装 |
| **启用**（`enabledPlugins["quay@quay"]`） | **项目级**（`<quay repo>/.claude/settings.json`，提交） | 它是**项目意愿**，对任何在本仓库工作的人都成立，且**不应外溢到别的项目** |

```
~/.claude/settings.json          extraKnownMarketplaces.quay = directory → <本仓库>/plugin   ✅ 允许（唯一允许项）
                                 enabledPlugins["quay@quay"] = true                          ⛔ 禁止（删除或置 false）
<quay repo>/.claude/settings.json  enabledPlugins["quay@quay"] = true                        ✅ 在这里启用
<本机其它项目>                    不启用 ⇒ 不注入 skills / 不进 PATH / 不起 MCP 进程            ✅ 目标态
```

**⊢ 这恰好是裁定 3「配置文件」边界在本问题上的具体落法**：机器特定的东西（源路径）留在用户级、
不进仓库；项目意愿（启用）进仓库、随 clone 传播。**两者本来就该分层，此前是被安装脚本合并了。**

**AC5（能取假）**：在任一**非** quay 项目起会话 ⇒ `PATH` 不含 `<quay>/plugin/bin`
**且** `quay:author` NOT-AVAILABLE。*取假方式*：把用户级启用改回 `true` 即红——**当前状态就是红**。

**⚠️ 与 T3 的相互作用（落地时必须一并处理，否则会把自己锁在门外）**：
项目级启用要求 ①插件**已安装**（启用 ≠ 安装，§9-T3）②该目录**已被信任**（未信任 ⇒ 项目 settings 整份不读）。
⇒ 迁移动作的正确顺序是：**先确认已安装 → 再在项目级置 true → 最后才撤掉用户级启用**；
反序执行会得到"哪里都没有 quay"的状态。
**⇒ 且 `register-plugin.mjs` 的行为要跟着改**：它现在写的是用户级启用，那正是污染源
（安装可以是全局的，启用不该是）。

## 5. 五阶段

| 阶段 | 机制（正本指针） | 本规格的改动 |
|---|---|---|
| 开发 | 本仓库通过插件消费自己 | 退掉三处第二副本（§6-1/2/3） |
| build | `plugin/scripts/sync-vendor.sh`（3 个自动触发点 + `--check` 硬闸） | **不动**（已是「源码受控 / 运行 copy 不受控且自动保鲜」） |
| 版本 | `scripts/version-consistency-check.ts`（8 文件锁步，fail-closed） | **不动**（仅补 §7-4 散文漏网） |
| 发布 | `publish-dist-branch.sh` → orphan `dist-plugin`；CI `publish-plugin-dist.yml` | **不动**；明确 marketplace 为主渠道 |
| 部署 | `quay-init` | **只写配置**（§6 闭集），2000 行 → 数十行 |
| 应用 | 装插件 → 跑一次 init → 用 | 升级由插件自动更新承担，**不再需要重跑 init** |

**升级语义的改善是这条架构最实的收益**：
现状升级要重跑 quay-init 并对 43 个铺设文件逐个走三态判定（而 CONFLICT ⇒ skip ⇒ 静默不生效）；
改后**插件更新即生效**，配置文件不参与升级。

## 6. 安装写入闭集（`quay-init` 新契约）

**裁定 6 定性**：`quay-init` 的**主要操作 = 创建符合 quay 要求的项目文件**（任务目录、quay 配置），
**⛔ 不复制任何 Claude Code 扩展或脚本**。它是一个**项目初始化器，不是一个安装器**。

```
【quay 自己的项目文件——这才是 quay-init 的本职】
.quay/config.yml         provider map + loop 参数
.quay/profiles.yml       launcher/model
tasks/                   任务目录（数据，不是扩展代码）
.gitignore               若干条目

【Claude Code 侧——只写配置，不写扩展】
.claude/settings.json    enabledPlugins（本项目启用，裁定 5）
                         + permissions.allow: ["mcp__plugin_quay_quay__*"]
```
**⊢ 两组的区别是本质的**：上组是 **quay 这个产品要求的项目结构**（换个宿主也需要）；
下组是**让宿主 Claude Code 知道去哪找已装好的插件**（一次性、幂等、纯配置）。
**⛔ `extraKnownMarketplaces` 不进项目 settings**——它是机器特定绝对路径，属 User Scope（§4b）。

**⚠️ 闭集之外必须有一个显式安装步骤（T3 实测结论，2026-09-02）**：
**settings 里的 `enabledPlugins` 只能启用/停用一个【已安装】的插件，不会去安装它**
（差分对照见 §9-T3）；且**未信任目录下项目 `.claude/settings.json` 整份不被读取**
（`hasTrustDialogAccepted` 门，`--dangerously-skip-permissions` 不解此门）。
⇒ **「把配置提交进仓库，clone 的人就自动装上」是不成立的**
⇒ 交付流程必须显式包含 `claude plugin marketplace add` + `claude plugin install`
（或 npm 全局安装路径的 `register-plugin.mjs`，它正是这么做的：写 settings **并** shell 出去装），
且首次进入该目录的人**必须先接受信任对话**，配置才开始生效。
**⛔ 不得把这一步写成「配置即生效」——那会退回本仓库最贵的那类失败：存在≠生效。**
**⛔ 不再写入**：`.claude/workflows/`、`.claude/agents/`、`plugin/scripts/` 副本、
`orchestration/` tick 文档、`docs/analysis/`——**以及随之退役的 managed/conflict/stale 整套机器。**

## 7. 退役 / 改造清单

| # | 对象 | 理由 |
|---|---|---|
| 1 | `quay-init` 的扩展文件复制 + 三态判定机器 | 裁定 1 |
| 2 | `.claude/skills/*`（5 个） | 3 个是 ADR-022 已退役经典循环的遗留（当前执行核零引用，实测）；2 个是裁定 2 禁的精简版重复 |
| 3 | `.claude/workflows/*`（5 个双副本） | §3b：从未提供能力，只提供漂移 |
| 4 | root `.mcp.json` 的 quay 条目 + `.claude/settings.local.json` 的 `enabledMcpjsonServers:["quay"]` | 它是「本项目用的路径 ≠ 交付路径」的唯一来源（裁定 2） |
| 5 | `plugin/agents/baime-iteration-executor.md` + `plugin.json` 对应条目 | 服务 ADR-022 已退役的经典里程碑循环；两层模式零调用；`plugin/README.md` 自承「无 baime 插件时退化」 |
| 6 | `workflows-dual-copy-drift-check.ts` | 双副本消失 ⇒ 检查器失去对象 |
| 7 | `plugin/skills/{quay-native,quay-webui-bootstrap}-methodology` 的「精简版」身份 | 裁定 2；与 `.claude/` 版合并为唯一一份 |
| 8 | `manager-tick-core.js` 迁入 `plugin/workflows/` | **裁定 4：manager 是产品一部分** ⇒ 交付了 manager skill 却不交付它依赖的 workflow，正是裁定 2 禁的病 |
| 9 | `~/.claude/settings.json` 的 `enabledPlugins["quay@quay"]=true` → 迁到项目级 | **裁定 5**：实测该条目把 quay 扩展面注入本机每个项目（`/home/yale` 会话 PATH 含 `<quay>/plugin/bin` ×2）。**迁移须按 §4b 的顺序**（先确认已装 → 项目级置 true → 最后撤用户级），反序会把自己锁在门外 |
| 10 | `register-plugin.mjs` 写**用户级启用**的行为 | 同上：它是污染的产生点。**安装可以全局，启用不该全局**——改为只注册 marketplace 源 + 安装，启用交给目标项目 |

**改造（非退役）**：
- **7-2**：全部 `plugin/skills/*/SKILL.md` 的 `allowed-tools` 统一为 `mcp__plugin_quay_quay__*`
  （当前 `loop-driver`、`routines` 两处违反，§3c）。
- **7-4**：`plugin/README.md:3` 散文仍写 v0.4.0（实际 0.6.1）——它**不在受检 8 文件内**，故未被闸捕获。

## 8. 不变式（可机械判定，且能取假）

- **AC1 无第二份**：本仓库 `.claude/{skills,workflows,agents}` 下不存在 quay 自己的副本。
  *能取假*：放回任一副本即红。
- **AC2 命名空间一致**：`plugin/skills/*/SKILL.md` 中出现的 `mcp__` 工具名全部为 `mcp__plugin_quay_quay__*` 形式。
  *能取假*：当前状态即红（`loop-driver`/`routines`）——**先红后绿，不是恒绿**。
- **AC3 安装写入闭集**：`quay-init` 写入目标的路径集 ⊆ §6 闭集，
  且**不含任何 `.claude/{skills,workflows,agents}` 或脚本副本**（裁定 6）。
  *能取假*：恢复任一类铺设即红。
- **AC5 作用域不外溢**（裁定 5，判据全文见 §4b）：非 quay 项目的会话中
  `PATH` 不含 `<quay>/plugin/bin` **且** `quay:author` NOT-AVAILABLE。
  *能取假*：**当前状态即红**（实测 `/home/yale` 会话 PATH 含该路径两次）——先红后绿。
- **AC6 用户级只承载源**：`~/.claude/settings.json` 中与 quay 相关的键
  **只有** `extraKnownMarketplaces.quay`，**没有** `enabledPlugins["quay@quay"]`。
  *能取假*：写回该启用键即红。
- **AC4（反例判据）**：三条 AC 都不得只靠 fixture 满足——AC1/AC2 读仓库真实文件，
  AC3 读一次真实 laydown 的产物清单（硬规则 4 推论三：读生产载体，不读注入数据）。

## 9. 四项实测：已全部完成（2026-09-02）

| # | 结论 | 证据（实测，非文档推断） |
|---|---|---|
| **T1** `${CLAUDE_PLUGIN_ROOT}` | ✅ **可用，skill 载入时文本级展开为绝对路径** | 磁盘 `quay-task-operator/SKILL.md:71` 写 `node "${CLAUDE_PLUGIN_ROOT}/scripts/task-schema-check.ts"`；载入会话后收到的是 `node "/home/yale/work/quay/plugin/scripts/task-schema-check.ts"`。连传入的 ARGUMENTS 串一并被替换 |
| **T2** 改动是否热生效 | ❌ **需重启会话**（**未在活会话直接实测**，见下方限定） | `claude plugin update` 帮助文本「**restart required to apply**」；`claude plugin init`「**auto-loads next session**」；`claude plugin` 子命令表**无 reload** |
| **T3** clone 者是否自动装上 | ❌ **不会**。①**启用 ≠ 安装** ②**未信任目录下项目 settings 整份不读** | ①差分：`--settings '{"enabledPlugins":{"quay@quay":false}}'` ⇒ `quay:author` **NO**；无旗标 ⇒ **YES**（证明 settings 路径确实生效）；而声明了 marketplace+enabledPlugins 的探针插件全程 NOT-AVAILABLE ⇒ 差异只能归于「没装」。②探针项目的 `env` 键同样不生效，且该项目不在 `~/.claude.json` `projects` 表中（`hasTrustDialogAccepted` 键存在于该表）；`--dangerously-skip-permissions` 不解此门 |
| **T4** `bin/` 上 PATH | ✅ **成立** | 本会话 PATH 含 `/home/yale/work/quay/plugin/bin`——**而该目录并不存在**；meta-cc/archguard 的 `bin` 同形在列 ⇒ Claude Code 对每个启用插件无条件加入该路径 |

**T1 的后果**：§6 闭集**不需要**裁定 3 允许的那条 plugin-root 文件指针——那条退路用不上。
**T3 的后果**：§6 闭集**必须**外挂一个显式安装步骤（已写入 §6）。**两条方向相反，都改变了闭集。**

**T2 的限定（诚实记录，勿当已验证）**：该结论由 CLI 帮助文本推得，**没有做活会话热改实验**——
做那个实验必须改动线上 `plugin/` 树，而该树正被自主循环的 worker 会话实时消费、
且主检出的脏文件会影响 fan-in 的 clean-tree 判定。**判定为不值当，记为「CLI 自述，未活体验证」。**
若后续需要硬证据，正确做法是拿一个**独立的临时插件**做（本轮 T3 已跑通该手法）。

## 10. 影响面（会波及的既有机件/文档，落地时须同步）

- `orchestration/SPEC-complete-delivery-surface-2026-08-05.md` 是**活文档**（六类交付面机读清单），
  由 `plugin/scripts/l1-delivery-surface-check.ts --surface` 机械消费
  ⇒ **交付机制从「复制」改为「原生」后，该清单与 L1 检查须同步**，否则 L1 会按旧交付面判定。
- `plugin/skills/init/SKILL.md`（quay-init 的产品表层）与 `plugin/scripts/quay-init.sh` 的契约同时收缩。
- `plugin/test/quay-init*.test.mjs`（≥7 个测试）断言的是旧铺设契约，随 §6 一并改写。
- CLAUDE.md「Architecture — the methodology layer」中关于 quay-init 铺设的描述须更新为新契约。

---

**状态**：规格已裁定；**§9 四项实测已全部完成（T2 为 CLI 自述、未活体验证）**；§7 退役清单待拆条执行。

**退役清单的可量化收益（2026-09-02 实测，`claude plugin details quay`）**：
14 个 skill **每会话常驻 ~2,706 tok**；其中 `quay-native-methodology`(~210) 与
`quay-webui-bootstrap-methodology`(~230) 经实测为**当前两层执行核零引用**
⇒ 仅这两项即 **~440 tok × 每一个会话**。**退役理由第一次有了读数，不再是「感觉冗余」。**
