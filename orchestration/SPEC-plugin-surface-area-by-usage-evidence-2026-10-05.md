# SPEC：按实际使用记录调整 quay plugin 的对外表面积

**作者**：Claude（交互会话）｜**日期**：2026-10-05｜**状态**：proposal，**待人裁定排期**
**来源**：人 2026-10-05 在交互会话中依次提出：①评估 plugin 的 skill / MCP 是否需要调整；②在 Claude Code CLI 中提示与输入都应是 `/quay:init` 这样的形式；③「审视 plugin 面向外部用户的表面积是必要的。重点不是问我，而是检查实际的使用记录。」

本文把该会话里**已测得的读数**与**未测的部分**分开写。凡带「读数」的是跑出来的数；凡带「推断」的没有被检验；凡带「未查」的没有读过。

---

## 0. 一句话

**plugin 实际被用到的表面很窄（1 个 skill + 1 个 subagent + 4 个 task MCP 动词 + 少数 lifecycle 动词），而它向每个装了它的项目的每个会话注入了 13 个 skill 描述、6 个 workflow 命令和约 30 个 MCP 工具；同时存在命名/重复注册的缺陷与 MCP 覆盖缺口（goal）。** 建议按证据强弱分三类处理：修缺陷（有实测）、补缺口（有使用记录）、降级零证据项（只降级不删除）。

---

## 1. 调查方法与它的边界

### 1.1 扫描对象与谓词

- **载体**：`~/.claude/projects/**/*.jsonl`，共 **5,022** 个文件，含主会话、直属 `subagents/`、`workflows/` 三层；其中含 `"tool_use"` 的行 **361,436**。
- **判定位置**：只数 `message.content[]` 里 `type=="tool_use"` 的块，按 `name` 与 `input` 字段分类；文本中的提及不算（硬规则 2）。
- **项目归一化**：目录名前缀 `-data-home-yale-work-` 与 `-home-yale-work-` 都归一（见 §1.3 的更正）。
- **窗口**：「全历史」=上述文件存量；「近期」=2026-09-21 起。全历史的起点**未查**。
- **为何不用 meta-cc**：它只读主会话 jsonl，不递归 `subagents/` 与 `workflows/`（CLAUDE.md 硬规则 1）。
- **读数产物**：`/tmp/usage/result.json`（临时，可能被清理）；脚本见附录 A。

### 1.2 分类口径

| 类别 | 取什么 |
|---|---|
| Skill | `tool_use name=="Skill"` 的 `input.skill` |
| Workflow | `name=="Workflow"` 的 `input.name` 或 `input.scriptPath` 的文件名 |
| Agent | `name=="Agent"/"Task"` 且 `subagent_type` 含 quay/archguard/meta-cc |
| ReadSkillMd | `name=="Read"` 且 `file_path` 以 `/skills/<名>/SKILL.md` 结尾且含 quay |
| MCP | `name` 以 `mcp__` 开头、含 quay、不含 archguard/meta-cc |
| BashPluginScript | `name=="Bash"` 且命令含 `plugin/scripts/<名>.(ts|sh)` |
| BashQuayCli | `name=="Bash"` 且命令含 `quay (driver|task|gate|goal|serve|init|…)` |

### 1.3 对照与自检（硬规则 2 / 4）

- **正向对照**：`quay-file-task` 是已知为真的样本，位置口径能命中（360 + 27 + 1，见 §2.1），谓词有效。
- **⚠ 未对上的差异**：早先一次按 `"skill":"…"` 子串（不区分位置）统计，`quay-file-task` 三种写法合计 **776** 次，位置口径合计 **388** 次，约两倍。**原因未查**——可能是子串口径把 `tool_result` / 进度行 / 重复落盘行也数进去了，也可能是位置口径漏了某种行形态。**因此本文所有绝对计数应按「±2 倍量级」理解，各项之间的相对大小与「是否为 0」的判断不受影响（同一口径）。** 重跑时应先对一小批会话手工核对该差异。
- **一次已发现的仪器故障（更正）**：此前给出的「`quay-fleet`、`cantus` 等调用数为 0」是错的。原因是目录前缀只匹配了一种。归一化后 `quay-fleet` 有 `quay-file-task` 55 次、task MCP 约 450 次、CLI 500+ 次。**凡早先报告中「某项目为 0」的说法一律作废。**
- **一次已发现的无效判据**：`claude -p` 的 init 消息里 `slash_commands` **不反映** frontmatter `name:`（改前改后都显示 `quay:init`），不能用作命名判据，只能判 `quay:SKILL` 是否存在（见 §3.2）。

### 1.4 没有覆盖的路径

- **未查**：driver 构造的 `claude -p` worker 提示文本里有无引用 skill 名。只在脚本与 workflow 里查到两处真实读取（§2.3）；其余命中的 `skills/<名>/SKILL.md` 多为静态检查在校验 skill 文件本身，不是使用方。
- **未查**：`lifecycle_retreat` 与 `lifecycle_promote` 的不对称（§2.6）。
- **说明**：被统计的项目 `claudecodeui`、`quay-fleet`、`archguard`、`meta-cc` 都是**本仓库作者自己的项目**，不是第三方；本文中「外部项目」均指这个意思。**没有第三方用户的使用证据。**

---

## 2. 读数

### 2.1 Skill（经 `Skill` 工具；全历史 / 近期；各项目计数）

| skill | 全历史 | 近期 | 末次 | 项目分布 |
|---|---|---|---|---|
| `quay:quay-file-task` | 360 | 270 | 2026-10-05 | claudecodeui 241、quay-fleet 55、quay 53、archguard 8 |
| `quay-file-task`（无前缀） | 27 | 13 | 2026-10-01 | quay 14、claudecodeui 12、quay-fleet 1 |
| `quay:drivers` | 10 | 4 | 2026-10-02 | claudecodeui 4、quay 3、meta-cc 2、quay-fleet 1 |
| `quay:manager-tick-core` | 6 | 5 | 2026-10-03 | claudecodeui 4、quay 2 |
| `quay:quay-native-methodology` | 1 | 1 | 2026-09-25 | claudecodeui 1 |
| `quay-dev:quay-file-task` | 1 | 1 | 2026-09-23 | claudecodeui 1 |

**`Skill` 调用全历史为 0 的 quay skill**：`execute`、`routines`、`run-routines`、`cold-start`、`loop-driver`、`quay-directive`、`init`、`pool-quality-judge`、`fan-in-execute`、`quay-task-operator`、`quay-task-to-plan`、`quay-webui-bootstrap-methodology`、`manager`。

### 2.2 直接 `Read` SKILL.md（旁路 1：不经 `Skill` 工具）

| skill | 次数 | 近期 | 项目 |
|---|---|---|---|
| quay-file-task | 88 | 70 | claudecodeui 51、quay 32、quay-fleet 5 |
| init | 13 | 11 | quay 10、meta-cc 2、claudecodeui 1 |
| manager | 3 | 3 | quay 3 |
| quay-native-methodology | 2 | 2 | claudecodeui 2 |
| routines | 1 | 1 | archguard 1 |
| drivers | 1 | 1 | quay 1 |
| execute | 1 | 1 | quay 1 |

（另有 `backend-module-standards`、`frontend-module-standards` 各 2 次，属 claudecodeui 自己的 skill，不在本 plugin 内。）

**直接读取和 `Skill` 调用合起来，才是 skill 的使用量。** 以 `init` 为例：`Skill` 0 次，但被读 13 次。

### 2.3 workflow 与脚本对 skill 的真实消费（旁路 2）

- `plugin/workflows/run-routines.js`：代码里读 `plugin/skills/routines/SKILL.md` 作为 agent 提示（注释写明 workflow 运行时里 `Skill()` 不可用，已改为 `agent()`）。
- `plugin/scripts/start-drivers.ts` 与 `drivers` skill 配套。
- 其余 `plugin/scripts/*` 对 `skills/<名>/SKILL.md` 的引用（`verify-delivery-surface.ts`、`spec-declaration-point-check.ts`、`serve-binding-literal-check.ts` 等）看路径与上下文属于**校验 skill 文件**，不是使用 skill。**这是按文件名与行内容的判断，没有逐个读代码确认。**
- `orchestration/` 的 SPEC 里有 `/quay:init`（11 处）、`/quay:drivers`（2）、`/quay:cold-start`（日志 2）等文字引用，属文档提及，不是调用。

### 2.4 Workflow 与 Agent

| 项 | 次数 | 项目 |
|---|---|---|
| Workflow `name: quay:manager-tick-core` | 5 | claudecodeui 4、quay 1 |
| Workflow `scriptPath` 指向 `manager-tick-core` 的两种文件名写法 | 1 + 1 | claudecodeui 1、quay 1 |
| Workflow `scriptPath` = `fan-in-execute.js` | 1 | quay |
| Agent `quay:quay-task` | 131（近期 127） | quay 79、claudecodeui 43、archguard 6、meta-cc 2 |

`fan-in-execute` 已退役为「机械 fan-in 失败时的语义兜底」（见其 skill 描述），使用量与此一致。

### 2.5 MCP（全历史 / 近期）

| 工具 | 全历史 | 近期 | 工具 | 全历史 | 近期 |
|---|---|---|---|---|---|
| `task_get` | 2,239 | 1,959 | `adr_list` | 21 | 14 |
| `task_check` | 1,934 | 1,614 | `lifecycle_complete` | 14 | 12 |
| `task_write` | 1,529 | 1,214 | `gate_run` | 6 | 5 |
| `task_list` | 850 | 746 | `driver_log` | 5 | 5 |
| `lifecycle_retreat` | 107 | 79 | `gate_list` | 4 | 3 |
| `lifecycle_promote` | 34 | 25 | `meta_list` | 4 | 2 |

其余：`task_delete` 4（仅 quay-fleet，近期 0）、`lifecycle_adjudicate` 3、`gate_log` 2、`config_validate` 2、`action_list` 1、`goal_get` 1、`init` 1、`meta_get` 1。
**全历史 0 次**：`action_run`、`adr_get`、`adr_write`、`instrument`、`meta_write`、`task_add_label`。
四个 `task_*` 合计 6,552 次，约占上列 MCP 调用（6,762）的 97%；`lifecycle_retreat` 的 107 次里 claudecodeui 占 73。

### 2.6 Bash 旁路（agent 不走 MCP / skill 而直接调脚本与 CLI）

- `plugin/scripts/*` 经 Bash 直接运行：**12,824** 次（quay 12,254、claudecodeui 401、archguard 65、meta-cc 47）；`instrument` MCP 为 **0** 次。
- 仅外部项目（claudecodeui、quay-fleet、archguard、meta-cc、cantus）涉及 **74** 个不同脚本，前列：`ready-pool-check` 228、`touches-orthogonality-check` 59、`worker-driver` 55、`runner-static-gate` 35、`anti-drift-touches-check` 34、`goal-driver` 28、`task-schema-check` 19、`full-suite-runner` 17。
- 外部项目的 `quay <cmd>` CLI：`task edit` 447、`goal`（合计）367（其中 `goal write` 230、`goal list` 68、`goal check` 25、`goal get` 25）、`task check` 258、`task list` 119、`driver status` 116、`serve` 70。
- **对比**：MCP 里只有 `goal_get`（1 次）与 `lifecycle_*`，没有 `goal_write` / `goal_list` / `goal_check`；agent 在 MCP 覆盖不到处改用 CLI。

### 2.7 上下文成本（静态读数）

- 13 个 `plugin/skills/*/SKILL.md` 的 `description:` 行合计 **6,803** 字符。较长的：`quay-file-task` 953、`quay-task-operator` 948、`quay-directive` 816、`manager` 650、`quay-webui-bootstrap-methodology` 606、`quay-native-methodology` 574。
- 6 个 workflow 的 description：`fan-in-execute` 1,268、`execute-suite-fix` 323、`drain-directives` 304、`manager-tick-core` 223、`run-routines` 219、`pool-quality-judge` 15。
- 这些描述会出现在装了 plugin 的每个项目的每个会话的 skill 清单里。**每个会话实际占多少 token 未测。**

---

## 3. 已实测的缺陷（有对照，可直接修）

### 3.1 同名 plugin 重复加载（本机配置问题）

- **现象**：在本仓库输入 `/quay` 时，`/quay:quay-init` 出现 4 次，`quay-drivers` 等出现 2 次。
- **读数**：`claude -p` 的 init 消息 `plugins` 列表里同时有 `quay`（`~/.claude/plugins/cache/quay/quay/0.14.0`）与 `quay`（`/data/home/yale/work/quay/plugin`）。启用来源两处：`~/.claude/settings.json` 的 `"quay@quay": true`，与本仓库 `.claude/settings.json` 的 `"quay@quay-dev": true`。
- **对照**：加 `--settings '{"enabledPlugins":{"quay@quay":false,…}}'` 后只加载本仓库那份。
- **处置（已做）**：在本机 `.claude/settings.local.json`（不入库）写入 `"enabledPlugins": {"quay@quay": false}`。重启后重复大部分消失（人 yale 复测确认）。

### 3.2 `plugin.json` 的 `commands` 数组重复注册（仓库缺陷）

- **读数**：`plugin/.claude-plugin/plugin.json` 的 `commands` 有 13 条，指向 `./skills/<x>/SKILL.md`；`plugin/skills/` 同时被自动扫描为 skill。官方文档（plugins-reference）：`commands` 指「扁平 .md 命令文件」并**替换**默认 `commands/` 扫描，`skills/` 总是自动扫描；`plugin/commands/` 目录不存在，删除不会丢默认命令。
- **对照（`claude -p --plugin-dir`，/tmp 副本）**：删除 `commands` 后 `slash_commands` 14→13，`quay:SKILL` 消失，13 个 skill 全部保留；`claude plugin validate` 通过。
- **对照（交互式，Claude Code v2.1.289，人 yale 读数）**：

| 副本 | `commands` | `init` 的 `name:` | `/quay` 里 `init` 次数 | 显示形式 |
|---|---|---|---|---|
| before | 有 | `quay-init` | 2 | `/quay:quay-init (quay-init)` |
| cmdonly | 无 | `quay-init` | 1 | `/quay:quay-init (quay-init)` |
| nameonly | 有 | `init` | 2 | `/quay:init` |
| after | 无 | `init` | 1 | `/quay:init` |

- **结论**：重名由 `commands` 数组造成；与 `name:` 无关。
- **未解释**：每份截图只有两行，未能确认其它 skill 在 `before` 里是否也被重复；不影响本缺陷的修复。
- **任务**：`gap-plugin-json-commands-array-duplicates-skills`（任务 A，立案时已晋升 `ready`，写本 SPEC 时已有 worker 执行中）。

### 3.3 frontmatter `name:` 与目录名不一致（仓库缺陷）

- **读数**：`init`→`quay-init`、`drivers`→`quay-drivers`、`cold-start`→`quay-cold-start`、`loop-driver`→`quay-loop-driver`、`manager`→`quay-manager`，共 5 个不一致；其余 8 个一致。
- **对照**：见 3.2 表——`name:` 决定交互补全的显示与输入形式（`quay-init`⇒`/quay:quay-init (quay-init)`，`init`⇒`/quay:init`），这正是人要求的 `/quay:init` 形式。
- **同源现象**：调用统计里 `quay:quay-file-task`（名字==目录名）与无前缀写法、`quay:drivers` 与 `quay-drivers` 的分裂。
- **任务**：`gap-skill-frontmatter-name-align-dirname-for-slash-form`（任务 B，`ready`，未开始）。应在任务 A 之后落地，二者都改 `plugin.json`。
- **提醒**：判据必须是**交互界面读数**或 `name:`==目录名的逐目录核对；**不能**用 `claude -p` 的 `slash_commands`（§1.3，在改动前就通过）。

### 3.4 对早先结论的更正（记录在案）

1. 「`execute` 与 `quay:SKILL` 重复，建议合并」：**错误**。`plugin/skills/execute` 与 `packages/quay-native/skills/execute` 是 `plugin/scripts/sync-vendor.sh:260-262` 有意镜像的同内容双份；`quay:SKILL` 是 §3.2 的 `commands` 产物，不是 skill。
2. 「补 quay-native 那份的 `name:`」：**不成立**，它已有 `name: execute`。
3. 「统一 `name:` 对显示名没有效果」：**部分错误**。该结论来自 `claude -p` 清单，该清单不反映 `name:`；交互界面里有效果（§3.2 表）。
4. 「`quay-fleet` 等项目调用数为 0」：**错误**，见 §1.3。

---

## 4. 建议（按证据强弱）

### P1　修缺陷（有对照）
- 落地任务 A（删 `commands` 数组）与任务 B（`name:`==目录名并同步旧名引用）。验收以**交互界面读数**为准：重启后输入 `/quay`，`init` 只出现一次且显示为 `/quay:init`。
- 重装用户侧：同名多来源（`quay@quay` + `quay@quay-dev`）是本机配置问题，不属仓库缺陷，但发布说明里应提醒「不要同时启用两个 `quay`」。（依据 §3.1。）

### P2　补 MCP 缺口（有使用记录）
- **依据**：外部项目 CLI `quay goal …` 合计约 367 次，MCP 只有 `goal_get`（1 次）。
- **提议**：确认 `goal write / list / check` 是否应有 MCP 动词；若是故意只留 CLI，应在 plugin 文档里写明，避免 agent 在 MCP 与 CLI 间任意选择。
- **同类**：`quay task edit` CLI 447 次 vs `task_write` MCP 1,529 次，二者并存；是否需要统一，**未调查**。

### P3　压缩常驻上下文（有静态读数，无 token 读数）
- **依据**：§2.7，13 个 skill 描述 6,803 字符 + 6 个 workflow 描述。
- **提议**：优先压缩 `quay-file-task`（高频但 953 字符）、`quay-task-operator`、`quay-directive`、`quay-webui-bootstrap-methodology`、`fan-in-execute`（已退役却是最长的 workflow 描述 1,268 字符）。保持描述内的触发条件与「何时不用」，把过程性内容留在 SKILL.md 正文。
- **前置读数**（建议先取）：skill 清单实际占的 token 与每会话加载频率，再定压缩目标；**不要先设数值目标**（硬规则 4 推论）。

### P4　对零证据 skill 降级，不删除
- **对象**：`quay-task-operator`、`quay-task-to-plan`、`quay-webui-bootstrap-methodology`、`loop-driver`、`cold-start`、`quay-directive`。它们 `Skill` 与 `Read` 全历史均为 0。
- **提议**：保留文件，不在默认安装里自动注入描述（按需加载或内部分发）。具体机制（plugin 拆分、`disable-model-invocation`、或移出 `skills/`）**需要先验证 Claude Code 的支持**，本文未验证。
- **不建议删除的理由**：①`cold-start`、`quay-directive` 在仓库内被脚本/文档引用（引用不等于使用）；②全历史窗口起点未查；③`Skill` 之外还有 §2.3 的两条旁路，旁路读数不完整。
- **留意**：`routines` 全历史 `Skill` 0 次，但被 `run-routines.js` 当提示读；`init`、`manager`、`drivers` 有直接 `Read`。**这几个不属于零证据，不得并入本类。**

### P5　`instrument` 的去留
- **依据**：`instrument` 0 次 vs 直接跑 `plugin/scripts/*` 12,824 次。外部项目也在手写脚本路径（74 个不同脚本）。
- **提议**：二选一并**先取一次读数**——(a) 核对 agent 是否看到了 `instrument` 的描述，改进描述；(b) 承认脚本路径本身就是主界面，把 `instrument` 降为次要。选择前，需统计「agent 手写脚本路径时，是否在 `instrument action:list` 的清单里」。

### P6　不属于本次调整，但应单独调查
- `lifecycle_retreat` 107 次 vs `lifecycle_promote` 34 次（claudecodeui 73 次回退）。这是**任务质量信号**，不是 plugin 设计问题。

---

## 5. 验收（本 SPEC 自身的 AC 候选）

- [ ] P1：交互界面（重启后）`/quay` 里每个 skill 只出现一次，且五个改名的 skill 显示为 `/quay:init`、`/quay:drivers`、`/quay:cold-start`、`/quay:loop-driver`、`/quay:manager`（人工关卡，待外部）。
- [ ] P2：对每个被归为「应有 MCP 动词」的 CLI 命令，写出判定依据与 MCP 动词，或在文档里写明故意不提供；以仓库内 grep 命中与 MCP 工具列表的差集给出清单。
- [ ] P3：取得 skill/workflow 描述的 token 读数后，才设压缩目标；压缩后触发行为不变（至少以 `quay-file-task` 的近期调用数不降为对照）。
- [ ] P4：降级方案先在 `/tmp` 副本上用 `claude plugin validate` 与交互界面各验证一次，再动仓库。
- [ ] P5：贴出「手写脚本路径 vs `instrument action:list` 清单」的差集。
- [ ] 本 SPEC 的 §2 读数在落地后用同一扫描脚本（附录 A）重跑一次，并与 §2 比较；**重跑的项目目录前缀须归一**。

---

## 6. 开放问题（需要人裁定）

1. 对外发布的 plugin 的目标用户是谁？目前只有作者自己的项目有使用证据。若只服务内部 loop，P4 的降级可以更激进；若面向第三方，则应拆分「用户面」与「内部编排面」。
2. `goal` 在 MCP 的缺口是故意还是遗漏？
3. 全历史窗口的起点是否需要限定（旧版本的使用模式可能已不适用）？

---

## 附录 A：扫描脚本（可复现）

主扫描（`/tmp/usage/scan.mjs`，node ≥20；输出 `/tmp/usage/result.json`）：

```js
import fs from 'node:fs'; import path from 'node:path'; import readline from 'node:readline';
const root = process.env.HOME + '/.claude/projects';
const files = [];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(e.name.endsWith('.jsonl')) files.push(p);} })(root);
const cut14 = Date.parse('2026-09-21T00:00:00Z');
const R = {};
const bump=(kind,key,proj,ts)=>{ const k=(R[kind] ??= {}); const o=(k[key] ??= {all:0,recent:0,projects:{},first:null,last:null}); o.all++; if(ts>=cut14) o.recent++; o.projects[proj]=(o.projects[proj]||0)+1; if(!o.first||ts<o.first)o.first=ts; if(!o.last||ts>o.last)o.last=ts; };
for (const f of files) {
  const proj = path.relative(root,f).split(path.sep)[0].replace(/^-data-home-yale-work-/,'').replace(/^-home-yale-work-/,'');
  const rl = readline.createInterface({input: fs.createReadStream(f), crlfDelay: Infinity});
  for await (const line of rl) {
    if (!line.includes('"tool_use"')) continue;
    let j; try { j = JSON.parse(line);} catch { continue; }
    const ts = Date.parse(j.timestamp||'') || 0; const c = j.message?.content; if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b?.type!=='tool_use') continue; const n=b.name, inp=b.input||{};
      if (n==='Skill') bump('Skill', inp.skill, proj, ts);
      else if (n==='Workflow') bump('Workflow', inp.name || path.basename(inp.scriptPath||'?'), proj, ts);
      else if (n==='Agent'||n==='Task') { if(/quay|archguard|meta-cc/.test(inp.subagent_type||'')) bump('Agent', inp.subagent_type, proj, ts); }
      else if (n==='Read') { const m=/\/skills\/([^/]+)\/SKILL\.md$/.exec(inp.file_path||''); if (m && /quay/.test(inp.file_path)) bump('ReadSkillMd', m[1], proj, ts); }
      else if (n.startsWith('mcp__') && /quay/.test(n) && !/archguard|meta-cc/.test(n)) bump('MCP', n.replace(/^mcp__[a-z_]*quay_quay__|^mcp__quay__/,''), proj, ts);
      else if (n==='Bash') { const cmd=inp.command||''; if (/plugin\/scripts\/[a-z0-9-]+\.(ts|sh)/.test(cmd)) bump('BashPluginScript','any',proj,ts); if (/\bquay (driver|task|gate|goal|serve|init|complete|promote)/.test(cmd)) bump('BashQuayCli','any',proj,ts); }
    }
  }
}
fs.writeFileSync('/tmp/usage/result.json', JSON.stringify({R},null,1));
```

第二个脚本（`/tmp/usage/scan2.mjs`）只对外部项目（`claudecodeui|quay-fleet|archguard|meta-cc|cantus`）从 Bash 命令里抽取 `plugin/scripts/<名>` 与 `quay <子命令>` 的分布，产出 §2.6 的 74 个脚本与 CLI 分布。

**已知限制**：①`Skill` 之外的两条旁路只做了脚本与 workflow 的静态检查，未逐个读代码；②`BashQuayCli` 的子命令正则只收录了列出的几个动词，未命中的 CLI 不在表里；③`近期` 窗口只用一个起点（2026-09-21）。

---

## 附录 B：相关任务与改动

- `gap-plugin-json-commands-array-duplicates-skills`（任务 A）：删除 `plugin.json` 的 `commands` 数组。
- `gap-skill-frontmatter-name-align-dirname-for-slash-form`（任务 B）：5 个 skill 的 `name:`==目录名。
- 本机配置（不入库）：`.claude/settings.local.json` 的 `enabledPlugins` 加 `"quay@quay": false`。
- 临时实验副本：`/tmp/quay-plugin-exp/{before,cmdonly,nameonly,after}`（可能被清理）。
