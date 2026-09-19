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
**且** `quay:execute` NOT-AVAILABLE。*取假方式*：把用户级启用改回 `true` 即红——**当前状态就是红**。

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
goals/                   目标目录（数据，与 tasks/ 双载体）
.gitignore               若干条目

【Claude Code 侧——只写配置，不写扩展】
.claude/settings.json    enabledPlugins（本项目启用，裁定 5）
                         + permissions.allow: ["mcp__plugin_quay_quay__*"]
```
QUAY-INIT-CLOSED-SET:BEGIN
- .quay/config.yml
- .quay/profiles.yml
- tasks/
- goals/
- .gitignore
- .claude/launch.settings.json
- .claude/settings.json
QUAY-INIT-CLOSED-SET:END

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

## 6b. 非 skill 入口如何定位 plugin 脚本（**AC168 的承重前提，2026-09-05 补**）

**⚠️ 本节是本规格 09-02 初稿的一个缺口，不是新增需求。** §9-T1 实测「`${CLAUDE_PLUGIN_ROOT}` 零复制直调成立」
**只覆盖 skill 载入路径**（它是 skill 载入时的文本级展开）；而**两层循环的引擎不是 skill 起的**。

**实测（2026-09-05，读码 + 行号核对，非推断）**：
```
packages/quay/src/cli/driver.ts:166   const kernel = path.join(root, "plugin/scripts/driver-runtime.ts")
                        :167-169      缺失即 `driver runtime kernel not found` 退出
                        :16-20        注释写明这是 AC139-4 故意为之——⛔ 不得用 import.meta.url walk-up，
                                      它会命中 worktree 副本（2026-08-23 常驻 supervisor 挂在短命 worktree
                                      上的载体死亡根因）
```
⇒ **今天下游项目能跑两层循环，恰恰依赖 quay-init 复制进去的那 117–131 个脚本。**
⇒ **§6 闭集一旦生效（不复制脚本），`quay driver start` 在每一个下游项目都会失败。**
**⊢ 最贵的一点：这个失败在本仓库永远复现不出来**（本仓库自带 `plugin/`，解析恒成功）
——**"在这里绿"是结构上不可能取假的量**（硬规则 4），判据必须落在一个**无本地 `plugin/`** 的 workspace 上。

**解析器契约（三条约束，缺一即不成立）**：

| # | 约束 | 为什么不能放弃 |
|---|---|---|
| ① | 从 worktree 调用时**永不**命中 worktree 副本 | AC139-4 的原始约束，有一次真实载体死亡作背书 |
| ② | **不要求**目标项目本地存在 `plugin/` 副本 | 否则等于没废除复制，裁定 1 落空 |
| ③ | npm-global 与 plugin marketplace **两条安装路径都能解析到** | 两条都是受支持渠道（§6 已把显式安装步骤写进交付流程） |

**⇒ 落点**：`tasks/gap-plugin-root-resolution-non-skill-entrypoints`（2026-09-05 立案，已实现并回填）。

**选定方案（2026-09-05 回填）**：单一解析器 `packages/quay/src/plugin-root.ts`，导出
`resolvePluginRoot()` / `resolvePluginScript()`。解析顺序：① `QUAY_PLUGIN_ROOT` env 显式指针
（hermetic 测试 / 运维覆盖）→ ② 若本模块（`import.meta.url`）从 linked worktree 载入 ⇒ 改解析到
**主检出** `plugin/`——`mainCheckoutRoot()` 用 `git worktree list --porcelain` 判非主 worktree（首条
= 主检出），fail-closed，永不回退到 worktree 副本 → ③ 从模块自身安装位置向上走（8 跳），每层探
`plugin/scripts/driver-runtime.ts` 与 `scripts/driver-runtime.ts` 两种 rel 形。`cli/driver.ts` 的内核
解析改走 `resolvePluginScript("scripts/driver-runtime.ts")`，AC139-4 的「拒绝 worktree root」一层仍在
driver 内，解析器内部的 worktree 重定向是第二层防御。

**被否方案与理由**：

| 被否 | 理由 |
|---|---|
| workspace root 拼 `plugin/scripts`（`driver.ts:166` 旧式，也是 serve-sessions.ts / ff-merge.ts / mcp-server.ts 的现式） | 违反 ②——要求本地副本；AC168 落地后每个下游项目都失败 |
| `import.meta.url` walk-up **无** worktree 判（`manager.ts:51-64` 现式） | 违反 ①——从 worktree 载入时命中 worktree 副本（AC139-4 的载体死亡根因） |
| `${CLAUDE_PLUGIN_ROOT}` 文本展开 | 只在 skill 载入时展开，CLI/cron/OS anchor 拿不到（§9-T1 已证） |

**旁注（2026-09-08，`gap-plugin-root-resolution-remaining-callsites` 的 AC1 分类结论）**——上表「被否方案」里的
「现式」点位并非全部下游可达；逐点分类后两类豁免（**仓库内部专用**，不走迁移，同 `scripts/test.sh`）：

| 豁免点 | 证据（逐条独立验证，非直觉） |
|---|---|
| `scripts/test.sh`（数十条 `${repo_root}/plugin/scripts/`） | 开发期测试入口：不在 npm `files` 白名单（`packages/quay/package.json` 的 `scripts/register-plugin.mjs` 是 `packages/quay/scripts/` 下，非 repo-root `scripts/test.sh`）；`plugin/.claude-plugin/plugin.json` 只 ship `skills/`+`agents/`；`quay-init.sh` 只 detect 不 copy（`:2058` 明写「no leaking the quay-specific scripts/test.sh」） |
| `os-anchor-watchdog.sh` / `os-anchor-install.sh` | 各自 header 明写「⚠ NOT A SHIPPED DELIVERABLE (human ruling 2026-08-06)… quay-init.sh never installs or invokes it」；实测 `quay-init.sh` 0 引用、`orchestration/*tick-core*.md` 0 引用（loop tick 文档里的「os-anchor-watchdog」只是观察者名单的散文提及，非调用指令） |

其余下游可达点（serve-sessions / ff-merge / mcp-server / precommit-guard / cli/manager / observation /
serve-send）已在该任务迁到本解析器（含 dist-bundle dev/dist 回退），负控制实测跑红、无本地 `plugin/` workspace
实测跑通（读数见任务体 Evidence）。

**三条约束 → 可执行判据**（缺一即不成立）：
① = 测试从 worktree 载入时断言解析结果在主检出、不在 worktree（把返回值改成 worktree 路径即红，
`mainCheckoutRoot()` 单测配真实 temp worktree 恒跑）；② = 无本地 `plugin/` 的临时 workspace 里仍解析到
（把解析器改回 workspace-root 拼接即红，实测跑出红）；③ = 两种 rel 形各覆盖一条安装路径——
`plugin/scripts/…` 覆盖 npm-global（`files` 白名单打包出 `<pkg>/plugin/`），`scripts/…` 覆盖
plugin marketplace（marketplace 根即 `scripts/` 的父目录）。

**⊢ 顺序是硬的：该任务 → AC168。** 反序 = 先把下游项目的循环引擎删掉，再去想怎么找它。
**⊢ 本任务只答「怎么解析」，不做 AC168 收缩本体；其余 workspace-root 拼接点（serve-sessions / ff-merge /
mcp-server / os-anchor / precommit-guard / scripts/test.sh）的迁移是收缩本体的连带面，不在此任务 Touches 内。**

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

**⚠️ 本表所有「退役」一律指 §12 的 archive（`git mv` + INDEX 行），不是 `rm`。**
**⊢ 且 #4（root `.mcp.json`）必须按 §11a-① 的迁移顺序做**：先接后撤，不得先撤后接——
它承载着 3 天 178 次的生产流量。

**改造（非退役）**：
- **7-2**：全部 `plugin/skills/*/SKILL.md` 的 `allowed-tools` 统一为 `mcp__plugin_quay_quay__*`
  （当前 `loop-driver`、`routines` 两处违反，§3c）。**它是 #4 迁移的前置**，不是独立改造项。
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
  `PATH` 不含 `<quay>/plugin/bin` **且** `quay:execute` NOT-AVAILABLE。
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
| **T3** clone 者是否自动装上 | ❌ **不会**。①**启用 ≠ 安装** ②**未信任目录下项目 settings 整份不读** | ①差分：`--settings '{"enabledPlugins":{"quay@quay":false}}'` ⇒ `quay:execute` **NO**；无旗标 ⇒ **YES**（证明 settings 路径确实生效）；而声明了 marketplace+enabledPlugins 的探针插件全程 NOT-AVAILABLE ⇒ 差异只能归于「没装」。②探针项目的 `env` 键同样不生效，且该项目不在 `~/.claude.json` `projects` 表中（`hasTrustDialogAccepted` 键存在于该表）；`--dangerously-skip-permissions` 不解此门 |
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

## 11. 三天使用实测（2026-09-02，覆盖全部三层 transcript）

**方法**：窗口 = 近 3 天内被修改的 731 个 transcript（全库 11,205），**含 `subagents/workflows/` 那一层**；
**按 JSON 键 / Bash 命令位置匹配，不按关键词**（第一版 workflow 计数因匹配到散文提及而作废重做）。
**文件级时间窗会高估** ⇒ **零可信，非零是上界**。
正控制三个：本轮自己打的 `quay:quay-task-operator` 出现在直方图里（skill 谓词有效）；
盲区层文件含 918 次 Bash（该层可见）；`subagent_type` 直方图含本轮自己的派发。

| 种群 | 读数 |
|---|---|
| `.claude/skills/` 5 个 | **全部 0** |
| `plugin/skills/` 14 个 | **12 个 0**；唯一真实使用 `quay-file-task` 4 次；`quay-task-operator` 1 次是本轮探针 |
| `.claude/workflows/` 6 个 | 仅 `manager-tick-core.js` **608 次**；其余 5 个 **0** |
| `plugin/workflows/` 5 个 | **全部 0** |
| `plugin/agents/` 1 个 | `quay:iteration-executor` **0**（派发的全是内建：general-purpose 38 / claude-code-guide 6 / Explore 2） |
| quay MCP 21 工具 | 裸 `mcp__quay__*` **178** 次 vs 插件 `mcp__plugin_quay_quay__*` **6** 次；21 个里只有 11 个被用过 |
| `plugin/scripts/` 309 个 | **有执行 178 / 零执行 131**；零执行中**无生产调用者 89**、有调用者 42；89 个里 **54 个自带测试** |

### 11a. 三条改变本规格判断的读数

**① 生产流量 97% 在本规格计划退役的命名空间上（178 : 6）。**
⇒ 退掉 root `.mcp.json` **不是清理，是主干路径搬家**。必须按迁移办：
**先让 `mcp__plugin_quay_quay__*` 承接（含 §7-2 的 `allowed-tools` 改造），再撤裸命名空间**，
且迁移期内两者并存。**⛔ 不得先撤后接。**

**② 唯一活着的 workflow 恰好是本规格要迁的那个（608 次/3 天）。**
`.claude/workflows/manager-tick-core.js` 608 次，`plugin/workflows/` 那 5 份全 0
⇒ §7-3（退双副本）+ §7-8（manager-tick-core 迁入 plugin）合起来会让**608 次/3 天的调用路径换文件**，
是整份规格里风险最集中的一步，需单独的迁移判据（迁后首个窗口内 `quay:manager-tick-core` 调用数 > 0）。

**③ skill 面近乎空转，scripts 面在扛活。** 盲区层 3 天内 918 次 Bash、**仅 1 次 Skill 调用**；
14 个 skill 每会话常驻 ~2,706 tok 换来 3 天 4 次调用。
**⚠️ 但本条不支持按零使用一刀切**：`cold-start`/`init`/`manager` 是**人触发、低频但关键**的能力，
**低频 ≠ 无用**。本读数支持的是「审视哪些必须常驻」，**不是**退役依据。
被本读数**加强**的退役项只有三处：`.claude/skills` 5 个（零使用 ∧ 执行核零引用）、
`plugin/agents` 1 个（零派发 ∧ 服务已退役循环）、`plugin/workflows` 双副本（零调用 ∧ 与 `.claude/` 版重复）。

### 11b. 已定位的仪器缺陷：`runtime-usage-inventory.ts` 有枚举盲区

**它的 `readTranscripts` 从不枚举 `<session>/subagents/workflows/<run>/agent-*.jsonl`**——
而那正是 workflow agent 干活的地方。实证：`monitor-mount-check.sh` 被它判 `unaccounted`（executed=0），
实际 3 天执行 **86** 次（其中 51 次在盲区层）；`quay-session.ts` 被判 `library`（executed=0），
实际 **68** 次（52 次在盲区层）。去掉 mtime 预筛数字不变 ⇒ **是目录枚举盲区，不是时间窗腐烂。**
**⇒ 它自报的 live=112 与本规格实测的 178 相差约 66 个脚本。**
**⛔ 它的 `unaccounted` 清单不得作为退役依据**（会删掉每天被调用几十次的脚本）。
**⊢ 与 CLAUDE.md 记载的 meta-cc `include_subagents` 坑同形**——只是这次犯在本仓库自己的普查器上。

### 11b-i. 排序补正：**修这个仪器必须排在「执行 archive」之前**（2026-09-05 补）

初稿把本条放在**乙组（AC160）**，位置在甲组的 AC158（执行 archive）**之后**。**这个顺序是错的**：
§12e 明写「**执行 archive 前须按 §12d 重算一次**」，而 §12d 的判据是「**三天零执行** ∧ 无生产调用者」
——**"零执行"读数正是本盲区的受害者**，本节自己也写了「⛔ 它的 `unaccounted` 清单不得作为退役依据」。
⇒ **不修就重算 = 按一份已知有缺口的读数删 97 个脚本**，其中可能含每天被调用几十次的对象。
**⊢ 硬顺序更正为：AC160 ──► AC156 重算 ──► AC158 执行 archive。**（`manager-phase-goal.md` 的顺序块已同步。）

### 11b-ii. ⚠️ 本节的两个负控制样本已腐烂一个（2026-09-05 核实）

`monitor-mount-check.sh` **已随 session-liveness 退役被删除**（`f2525e075` / `5444b8bf2`，2026-09 初；
2026-09-05 `ls` 核实不存在）⇒ **它不能再作判据锚点**。幸存的已知真样本是 **`quay-session.ts`**
（被判 `library`/executed=0，实际 68 次、52 次在盲区层）。
**⊢ 这是本规格自身的一个实例，值得记**：§12e 已自述死集名单是「带日期的快照，不是活文档」，
**而同样的腐烂也发生在【判据引用的样本】上**——判据必须锚在**执行当下核实过存在**的对象上，
不是立规格那天存在的对象上。落点：`tasks/gap-runtime-usage-inventory-workflow-blind-spot`（2026-09-05 立案）。

## 12. 统一 archive 机制（裁定：零调用先退役，需要时再恢复）

**人 2026-09-02**：「**对零调用的工具，先退役（archive），后续发现需要了再恢复。**」
⇒ archive 是**默认动作**，不是例外；**举证责任反转**：留下要理由，退役不需要。

### 12a. 落点与形状

```
archive/<YYYY-MM-DD>-<slug>/<保持原始相对路径>     例：archive/2026-09-02-zero-call-scripts/plugin/scripts/fork-baseline.ts
archive/INDEX.tsv                                  一行一个对象，机读
```
**⛔ archive 必须在 `plugin/` 之外**——`packages/quay/package.json` 的 `files` 含 `"plugin"`，
archive 放进去会**随每次发布交付一堆死物**；且 `capability-catalog.ts` 按目录列举 `plugin/scripts`，
子目录形式的 archive 会污染它的清单。
**⚠️ 更正（2026-09-19，`gap-ac157-catalog-carrier-moved-criterion-stale`）**：本句原写作
`capability-catalog.sh`。枚举承载者已于 2026-09-19 迁至 `plugin/scripts/capability-catalog.ts`
（`gap-arch-catalog-declarations-leave-bash` 把 `.sh` 抽成 thin exec wrapper，枚举 + `archive/**`
排除随迁，在 `.ts` 内以字面 `archive/` 路径段表达）。**点名承载者时以 `.ts` 为准**——判据绑在
文件路径上，承载者再搬迁时同款漂移会重演一次（AC-157 判据曾因此取假 12 天后才被发现）。
**⊢ 保持原始相对路径是为了让恢复是机械的**：`git mv archive/<批次>/plugin/scripts/x.ts plugin/scripts/x.ts`。

`archive/INDEX.tsv` 每行字段（缺一不可）：
`original_path · archive_path · date · reason_code · evidence · restore_cmd · commit`
其中 **`evidence` 必须是可复核的读数**（如 `exec_3d=0 callers=0 own_test=yes`），不是形容词。

### 12b. 纪律

1. **`git mv` + 写 INDEX 行必须在同一个提交里**（硬规则 7：要求记录某动作，就不能把记录排在动作之后）。
2. **脚本与它自己的测试同批移动**（`plugin/test/<stem>.test.mjs`）——否则留下孤儿测试或红套件。
3. **恢复协议**：`git mv` 回原路径 + 删 INDEX 行 + **重新登记它需要的那几个面**
   （capability-catalog 声明、测试 glob、Touches）。**恢复不是只把文件放回去。**
4. **不设过期**：archive 长期保留；INDEX 的 `reason_code` + `evidence` 就是未来判断的依据。

### 12c. 必须一并接线的排除面（不接线就会红）

`archive/**` 须被以下排除：**`capability-catalog.ts`**（枚举承载者；`.sh` 只是 thin exec wrapper，
⛔ 不是接线面）、`runtime-usage-inventory.ts`、
`scripts/test.sh` 的测试 glob、laydown/交付面闭包检查、`version-consistency-check.ts`。
npm 侧无需处理（`files` 是白名单，`archive/` 天然不在内）。
**⚠️ 更正（2026-09-19，`gap-ac157-catalog-carrier-moved-criterion-stale`）**：第一面原写作
`capability-catalog.sh`。枚举 + 该排除已于 2026-09-19 随 `gap-arch-catalog-declarations-leave-bash`
迁进 `capability-catalog.ts`（排除以字面 `archive/` 路径段表达，任意深度的 `archive` 目录仍被跳过，
`find -not -path '*/archive/*'` 行为等价）。**接线面清单点名文件时以承载该角色的文件为准**——
判据/清单绑在 `.sh` 上会在每次重构后重新变假（AC-157 判据即因此取假）。

### 12d. 退役判据（本次实测已产出可执行清单）

**ARCHIVE-CANDIDATE ≡ 三天零执行（全三层） ∧ 无生产调用者。**
「生产调用者」= 非测试代码中的 import 或调用点（其它脚本 / skill / workflow / 执行核文档 / CI）。
**⛔ 明确不算生产调用者的两类**：
① **它自己的测试**——测试只证明它能工作，**不证明有人调它**
（闭包后 94 个死集中 **56 个**正是这一类：「造好了、测试绿了、从没接进生产」，
与 CLAUDE.md 硬规则 4 推论三同形）；
② **注释 / 散文里的提及**（按位置判定，不按关键词）。
**⊢ 但要区分两种文档出现**：执行核 / skill / workflow 里**指示执行的命令行**算生产调用者；
**纯散文提及**不算——**只被后者「保住」的脚本归 §12e 的待裁桶**，不自动保留也不自动 archive。

### 12e. 传递闭包后的死集（2026-09-02 算毕，本节即清单正本）

**算法**：**根** = 三天内有执行（178 个）**∨** 被非脚本交付面引用；
**边** = 脚本 C 以 import 形式或调用形式引用脚本 S；
**KEEP** = 根沿边传播到不动点（C 被保留且 C 调用 S ⇒ S 被保留）；**DEAD = 全集 − KEEP**。
两个交付面口径各算一遍：
**严格**（shipped skills/workflows + 三个活执行核 + CI + 产品代码）**KEEP=212 / DEAD=97**；
**宽松**（再加任何 `orchestration/*.md` 与 `CLAUDE.md` 的引用）**KEEP=215 / DEAD=94**。
**取两者交集为安全核 = 94。**
**⊕ 人 2026-09-02 裁定后：那 3 个差集也 archive ⇒ 最终死集 = 97 = 严格口径的 DEAD。**
**⊢ 即：裁定选定的是严格口径——「指示执行」算活，「散文提及」不算。**（详见本节末尾与 §12f。）

**负控制通过**：`ready-pool-check.ts` / `worker-driver.ts` / `capability-catalog.sh` /
`monitor-mount-check.sh` / `quay-session.ts` 五个已知活跃脚本**无一落入死集**
（后两个正是仪器盲区受害者，闭包把它们判活 ⇒ 说明本算法读的是修正后的执行数据）。

**⚠️ 更正上一版的一句话**：上一版写「89 是下界，只增不减」——**「只增不减」是错的**。
闭包**加了 8 个**（调用者本身是死的：`build-evidence-manifest.ts`、`candidate-contracts.ts`、
`checker-cost.sh`、`coupling-graph.ts`、`drivable-workspace-check.sh`、`execution-policy.ts`、
`stage-receipt.ts`、`test-framework-policy-check.sh`），但也**移出了 3 个**
（`gate-staleness-check.sh`、`semantic-face-dispatch-record.ts`、`trend-check.ts`）——
它们被 `CLAUDE.md`/`orchestration` 引用而一级分析没搜那两处。
**其中 `semantic-face-dispatch-record.ts` 是 CLAUDE.md 明文规定的 manager 语义派发记录接口**
⇒ **archive 它会打断一条写在案的规程**。89 − 3 + 8 = 94。**⊢ 教训：扩大搜索面既会加也会减，
「下界」这个词把一个双向的修正说成了单向的。**

**⚠️ 本清单是【带测量日期的快照】，不是活文档。** 判据（§12d）是耐久的，名单会随代码演化过期；
**执行 archive 前须按 §12d 重算一次**，以重算结果为准。

**⊕ 死集重算回写（2026-09-08，`gap-dead-set-closure-misses-four-reference-kinds` 补认四类引用后）**：
按 §12d（三天零执行 ∧ 无生产调用者）+ §12e 传递闭包（补认 `${repo_root}/plugin/scripts/<name>`、
`path.join(__dirname, "<name>")`、`$SCRIPT_DIR/<name>` 三种执行形式，**再加四类引用**：bash `source`/`.`
内建（执行）、`plugin/test` 存在性钉、`.quay/config.yml` gate 注册、wrapper→委托模块对称对）+
§12f 裸文件名边重算；方法窗口与完整名单见 `docs/analysis/dead-set-recomputed.json`
（`generatedAt` 2026-09-08T06:32:14.678Z；窗口 2026-09-05T06:28:00.783Z → 2026-09-08T06:28:00.783Z，72h；
`executionDataSource` = 三层 transcript 普查，非 runtime-usage-inventory.ts）。

- 扫描前死集: 31
- 扫描后死集: 31

#### 安全核 94 个（`plugin/scripts/` 下，两口径下均判死；56 个自带测试须同批移动）

```
ac36-sortkey-criterion-check.ts          ac56-recommended-deordered-check.ts
ac61-staleness-disposition-check.ts      ac69-slot-queue-gap-check.ts
adr016-screen-use-check.ts               anti-gaming-guard.sh
anti-gaming-guard.ts                     assert-clean-tree.sh
audit-independence-check.sh              audit-independence-check.ts
axis-generator.ts                        build-evidence-collector.ts
build-evidence-gate.ts                   build-evidence-manifest.ts
candidate-contracts.ts                   candidate-synthesis.ts
check-set-after-change-check.ts          checker-cost.sh
checker-driver-result-ratchet-check.ts   claim-task.ts
codex-stage1-live-proof-check.ts         codex-stage1-selfcheck.sh
coupling-graph.ts                        cross-machine-verify.sh
develop-deliver-tgz.sh                   dispatch-record-fingerprint-reason-check.ts
drivable-workspace-check.sh              dual-source-check.ts
execution-policy.ts                      fan-in-runid-check.ts
finding-backpropagate.ts                 fork-baseline.ts
gate-dispatch-coverage.ts                gate-script-lib.sh
gate-staleness-check.ts                  git-lens-l-d-code-doc-ratio.ts
git-lens-l-s-behavior-variance.ts        inner-idle-log.ts
it0-enforcement-with-design-check.sh     it0-enforcement-with-design-check.ts
it0-impl-row-check.sh                    land-capacity-monitor.ts
live-repo-literal-assert-check.ts        load-sensitive-release-check.ts
loadbearing-test-gate.sh                 loadbearing-test-gate.ts
md-deletion-token-evaporation-check.sh   mirror-measure-history.ts
needs-human-recheck.ts                   obligation-ledger-check.ts
orphan-session-check.ts                  os-anchor-install.sh
outer-tick-log-check.sh                  overhead-instrument.sh
pipe-exit-code-check.sh                  portfolio-choice.ts
preference-notification-check.ts         prefriction-count.sh
preparation-feedback.ts                  prod-data-audit.ts
productization-verification-record-check.ts  provision-verify-worktree.sh
quay-dispatch.ts                         quay-suite.ts
red-window-triage.ts                     release-freshness-check.sh
run-identity.ts                          self-report-vocab-check.ts
session-liveness-sweep-kill.mjs          session-retirement-check.ts
stage-receipt.ts                         stale-ready-audit.ts
state-worded-clause-check.ts             suite-cutoff-verdict.mjs
suite-duration-exceed-check.ts           supervisor-health.sh
supervisor-observe.sh                    supervisor-preempt.sh
task-ac-carryover-check.ts               task-schema-check.sh
test-framework-policy-check.sh           tmp-leak-pairing-check.sh
tmp-leak-pairing-check.ts                tmux-isolated.sh
tmux-test-isolation-check.ts             tree-hygiene-check.sh
vmeta-lag-check.sh                       vmeta-lag-check.ts
workflow-baseline-metrics.ts             workflow-invariant-ownership.mjs
workflow-journal.ts                      workflow-metadata-conformance.mjs
workflow-replay.ts                       worktree-branch-hygiene-check.sh
```

#### 曾待裁的 3 个 → 人 2026-09-02 裁定：**取 (a)，连同那条文档提及一起 archive**

原为「严格口径判死、宽松口径判活，唯一活因是一条文档提及」的三个：
`gate-staleness-check.sh` · `supervisor-bus-identity.sh` · `trend-check.ts`。
**人的裁定原话**：「**连同那条文档提及一起 archive（承认该规程已不执行）**」。
⇒ **死集 94 + 3 = 97**，**恰好等于严格口径的 DEAD=97**
⇒ **该裁定在效果上就是「采用严格口径」：只有【指示执行】才算活，散文提及不算。**
（未被选中的另一条出路记录在案：保留并接进真正会跑的地方。**被明确排除的第三种**是
留文件、留文档、不接线——即硬规则 9「守与不守在记录上无法区分」。）

**⚠️ 这三个各自带一串连带清理，缺一就会留下悬空引用或直接弄红检查：**

| 脚本 | 必须同批处理的文档提及 | 其它耦合（不处理会红/悬空） |
|---|---|---|
| `gate-staleness-check.sh` | `orchestration/SPEC-goal-store-2026-08-09.md:240`（AC7 行规定每轮跑它） | `capability-catalog.sh:236`（声明）+`:534`（节奏「每轮」）；`rhythm-consumer-check.ts:93` 已自注「legacy，且 `.ts` 同胞也未接线」——**两个同胞一并入死集** |
| `supervisor-bus-identity.sh` | `orchestration/SPEC-integration-architecture-2026-08-05.md:174`、`orchestration/manager-loop-tick.md:270` | `capability-catalog.sh:351/:673`；**`plugin/scripts/quay-deliver.ts:19` 的交付清单含它**；**既有任务 `gap-inbox-message-bus-teardown` 已把「本脚本失效子命令退役」列为剩余面 ⇒ 必须并案，不得两头各做一半** |
| `trend-check.ts` | `orchestration/REVIEW-cadence.md:83`（规定的命令行） | **`SPEC-complete-delivery-surface-2026-08-05.md:240` 的机读行 `<!-- l1-category: 6 … deliverable: plugin/scripts/trend-check.ts …-->` + 表格 `:197`**——**不同步就会让 `l1-delivery-surface-check.ts --surface` 报第 6 类交付物缺失**（§10 已预告的活文档同步义务，这里是它的第一个具体实例） |

#### 12f. 闭包的一个已知检测缺口（由上表跟进时发现，对 97 个全体适用）

`quay-deliver.ts:19` 以 **`file: "supervisor-bus-identity.sh"` 这种裸文件名清单项**引用脚本；
而 §12e 的闭包只识别**两种形式**：import 说明符、`node|bash|sh|tsx … plugin/scripts/<name>` 调用行
⇒ **注册表/清单里的裸文件名引用检测不到。**
**⇒ 执行 archive 之前必须补一趟裸文件名扫描**（对象：`quay-deliver.ts` 这类清单、
`*.json` 清单、其它以数组/映射登记脚本的地方），把命中的从死集里摘出来单独判。
**⛔ 唯一不算引用的登记处是 capability catalog**（2026-09-19 更正：原写作 `capability-catalog.sh`；
枚举承载者已迁至 `plugin/scripts/capability-catalog.ts`，`.sh` 只剩 thin exec wrapper）——它是**对种群的描述**，不是使用；
把 catalog 条目当引用会让所有脚本永远活着（那正是硬规则 4「结构上不可能取假的量」）。
**⊢ 本缺口的发现方式值得记**：不是靠重读代码，是靠**执行一条裁定时去找它的连带面**——
裁定落地的动作本身就是对判据的一次负控制。

---

**状态**：规格已裁定；**§9 四项实测已全部完成（T2 为 CLI 自述、未活体验证）**；
**§11 三天使用实测已完成**；**§12e 传递闭包已算毕，人裁定后死集 = 97**（94 安全核 + 3 个原待裁）；
**§12f 的裸文件名扫描是执行 archive 的前置**；§7 退役清单 + §12e/§12f 待拆条执行。

**⊕ 2026-09-05 更新（人令「创建第一波任务」后）——两处补正 + 第一波 6 条已立案**：

两处**本规格自身的缺陷**（均在立案核查中发现，非读文档推得）：
① **§6b 新增**——`cli/driver.ts:166` 从 workspace root 解析驱动内核 ⇒ AC168 停止复制会让**下游 `quay driver start` 全线失效**，
   §9-T1 的 `${CLAUDE_PLUGIN_ROOT}` 只覆盖 skill 载入路径，救不了 CLI/cron/OS anchor。**AC168 的硬前置。**
② **§11b-i 排序补正**——AC160（修仪器盲区）必须排在 AC158（执行 archive）**之前**，否则按已知有缺口的执行读数删 97 个脚本；
   **§11b-ii** 并记：该节引用的负控制样本 `monitor-mount-check.sh` 已被删除，判据改锚 `quay-session.ts`。

**第一波 6 条任务（2026-09-05 立案，promotion-driver 已机械晋升 ready）**：

| 任务 | 对应 | 一句话 |
|---|---|---|
| `gap-plugin-root-resolution-non-skill-entrypoints` | §6b（新） | 非 skill 入口的 plugin-root 解析，AC168 硬前置 |
| `gap-skill-allowed-tools-plugin-namespace` | AC163 | 两处裸名改插件前缀 + 恒定判据；AC165 的硬前置 |
| `gap-runtime-usage-inventory-workflow-blind-spot` | AC160 | 修枚举盲区；**须先于 AC158** |
| `gap-archive-mechanism-and-exclusion-wiring` | AC157 | archive 机制 + 五面排除接线 |
| `gap-dead-set-registry-bare-filename-scan` | AC156 | 裸文件名扫描 + 死集重算（⛔ 不沿用 09-02 快照） |
| `gap-quay-init-closure-assertion-first` | AC168 判据先行 | 落地量棘轮（取实测基线，只降不升），收缩本体留后续波次 |

**⊢ 尚未立案的（等第一波落地后再拆，避免"永远差最后一步"）**：AC158/AC159（执行 archive 与连带文档）、
AC161/AC162（作用域外溢，其中 AC161 改 `~/.claude/settings.json`，**建议人执行**）、AC164/AC165（命名空间承接与撤裸）、
AC166/AC167（第二副本与 `manager-tick-core.js` 迁移，608 次/3 天的路径换文件，**须单独判据**）、
AC168 收缩本体与 AC169 交付面同步。

**退役清单的可量化收益（2026-09-02 实测，`claude plugin details quay`）**：
14 个 skill **每会话常驻 ~2,706 tok**；其中 `quay-native-methodology`(~210) 与
`quay-webui-bootstrap-methodology`(~230) 经实测为**当前两层执行核零引用**
⇒ 仅这两项即 **~440 tok × 每一个会话**。**退役理由第一次有了读数，不再是「感觉冗余」。**
