# 规格：Claude Code plugin 全生命周期——单一 bundle、原生交付、安装只写配置（人 2026-09-02）

**性质**：架构裁定 + 落地契约。覆盖开发 → build → 分发 → 部署 → （其它主机其它项目）实际应用。
**正本关系**：本文件只定**形态与判据**；build/版本/发布的既有机制已达标，**指针在第 3 节，不在此处复制**。

## 1. 人的裁定（2026-09-02，逐字）

1. 「**quay-init 复制 Claude Code 的各种扩展文件的行为应当废弃，这是非常糟糕的实践。**」
2. 「对于同一功能，**本项目自己使用的扩展应当与产品交付的是同一个**。不应有所谓『简化版用于产品交付』的情况。」
3. 「可以使用**配置文件**或（**非常克制的**）**文件指针**提供项目配置。」
4. （对本规格第 8 节遗留问题的裁定）「**manager 是产品一部分。**」

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
| scripts | `scripts/` | — | ✅ 309 个（调用方式见 §9 待测 T1） |
| **bin** | `bin/` → **进 Bash 的 PATH** | — | ❌ 未用（`plugin/bin/` 不存在） |
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

```
.claude/settings.json    enabledPlugins + extraKnownMarketplaces
                         + permissions.allow: ["mcp__plugin_quay_quay__*"]
.quay/config.yml         provider map + loop 参数
.quay/profiles.yml       launcher/model
tasks/                   任务数据（是数据不是扩展代码）
.gitignore               若干条目
```
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

**改造（非退役）**：
- **7-2**：全部 `plugin/skills/*/SKILL.md` 的 `allowed-tools` 统一为 `mcp__plugin_quay_quay__*`
  （当前 `loop-driver`、`routines` 两处违反，§3c）。
- **7-4**：`plugin/README.md:3` 散文仍写 v0.4.0（实际 0.6.1）——它**不在受检 8 文件内**，故未被闸捕获。

## 8. 不变式（可机械判定，且能取假）

- **AC1 无第二份**：本仓库 `.claude/{skills,workflows,agents}` 下不存在 quay 自己的副本。
  *能取假*：放回任一副本即红。
- **AC2 命名空间一致**：`plugin/skills/*/SKILL.md` 中出现的 `mcp__` 工具名全部为 `mcp__plugin_quay_quay__*` 形式。
  *能取假*：当前状态即红（`loop-driver`/`routines`）——**先红后绿，不是恒绿**。
- **AC3 安装写入闭集**：`quay-init` 写入目标的路径集 ⊆ §6 闭集。
  *能取假*：恢复任一类铺设即红。
- **AC4（反例判据）**：三条 AC 都不得只靠 fixture 满足——AC1/AC2 读仓库真实文件，
  AC3 读一次真实 laydown 的产物清单（硬规则 4 推论三：读生产载体，不读注入数据）。

## 9. 落地前置：四项待实测（未测不得动手）

| # | 待测 | 决定什么 | 成本 |
|---|---|---|---|
| T1 | `${CLAUDE_PLUGIN_ROOT}` 在 plugin skill 触发的 Bash 里是否可展开 | 309 个 scripts 是**零复制直调**、走 `bin/` PATH、还是需要裁定 3 的那条「克制的文件指针」 | 一次 skill 调用 |
| T2 | 改动 `plugin/` 下文件后是否需要 `/reload-plugins` 或重启 | 「用插件机制消费自己」的开发体感代价 | 改一行试一次 |
| T3 | 项目级 `enabledPlugins` 在 teammate clone 后是否自动安装 | `quay-init` 要不要提示手动装（文档未覆盖） | 一次干净 clone |
| T4 | `plugin/bin/` 上 PATH 的实际行为 | CLI 分发是否还需要 npm 全局安装 | 建 `bin/` 试 |

**T1 是承重的**：它决定 §6 闭集是否需要多一条 plugin-root 指针。

## 10. 影响面（会波及的既有机件/文档，落地时须同步）

- `orchestration/SPEC-complete-delivery-surface-2026-08-05.md` 是**活文档**（六类交付面机读清单），
  由 `plugin/scripts/l1-delivery-surface-check.ts --surface` 机械消费
  ⇒ **交付机制从「复制」改为「原生」后，该清单与 L1 检查须同步**，否则 L1 会按旧交付面判定。
- `plugin/skills/init/SKILL.md`（quay-init 的产品表层）与 `plugin/scripts/quay-init.sh` 的契约同时收缩。
- `plugin/test/quay-init*.test.mjs`（≥7 个测试）断言的是旧铺设契约，随 §6 一并改写。
- CLAUDE.md「Architecture — the methodology layer」中关于 quay-init 铺设的描述须更新为新契约。

---

**状态**：规格已裁定；§9 四项实测为落地前置；§7 退役清单待拆条执行。
