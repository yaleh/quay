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

- **已查（原为未查）**：driver 构造的 worker 提示不含 skill / workflow 名；driver 启动会话的实际使用见 §2.8。只在脚本与 workflow 里查到两处真实读取（§2.3）；其余命中的 `skills/<名>/SKILL.md` 多为静态检查在校验 skill 文件本身，不是使用方。
- **仍未查**：worker 是否加载了 plugin 的 skill 清单（取决于 `launchArgv` 的 `--bare`/`--settings`）；`goal-sufficiency follow-up` 会话；续做提示（continue worker）的归类。
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

**⚠ 更正（2026-10-05 后续核查，§2.8）：这张表里的多数读取是「维护」，不是「使用」。** 对每条 Read，核查同一会话里是否随后对同一个 SKILL.md 做了 `Edit`/`Write`：

| skill | Read 次数 | 同会话随后编辑同一文件 | 判读 |
|---|---|---|---|
| quay-file-task | 88 | 1 | 基本是使用 |
| init | 14 | 11 | 多为维护 |
| manager | 7 | 7 | 全为维护 |
| drivers | 2 | 2 | 全为维护 |
| cold-start | 1 | 1 | 维护 |
| loop-driver | 1 | 1 | 维护 |
| quay-native-methodology | 2 | 0 | 使用 |
| routines | 1 | 0 | 使用 |
| execute | 1 | 0 | 使用 |

（`init` 14 次是本次口径，表上方的 13 是之前一次扫描的数，口径差异未对。）**因此「`init` 被读 13 次所以在用」的说法作废：除 `quay-file-task` 之外，直接读取不能作为使用证据。** 仍成立的旁路只有 `run-routines.js` 在代码里把 `routines` SKILL.md 当 agent 提示读取（§2.3）。

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

### 2.8 driver 启动的会话（worker 等）在用什么

**driver 如何启动会话**：`plugin/scripts/driver-runtime.ts:1736` `launchArgv(role, prompt, root)` 产出 `[launcher, --settings …, (--model), (--bare), (--mcp-config …), -n <name>, -p <prompt>]`。`worker-driver.ts:1871` `buildWorkerPrompt` 的提示全文只含 worktree 创建、`dispatchSetupSignature`、AC 检查、预合并与 fan-in 说明，**没有任何 skill / workflow 名**（读了该函数全文）。

**怎么识别**：按主会话文件里第一条非元数据用户消息的前 120 字符归类；`subagents/`、`workflows/` 下的文件按所在会话目录归到父会话。读数在 `/tmp/usage/result4.json`，脚本 `scan4.mjs`。类别由 driver 提示的固定句式决定，不靠正则猜：

| 类别（提示开头） | 会话数 | `Skill` | `Workflow` | `Agent quay:quay-task` | 读 SKILL.md | MCP（前几位） | Bash 跑 `plugin/scripts/*` |
|---|---|---|---|---|---|---|---|
| resident task selector | 1,353 | 0 | 0 | 0 | 0 | `task_get` 196、`task_list` 31 | 80 |
| per-task worker | 1,347 | 无 quay skill（仅 claudecodeui 自己的 `*-module-standards` 12 次，`quay:quay-file-task` 1 次） | 0 | 13 | 见 §2.2 更正（均为维护） | `task_check` 1,614、`task_get` 1,362、`task_write` 725、`task_list` 88 | **6,814** |
| gap-filing agent | 445 | **`quay:quay-file-task` 296、`quay-file-task` 27、`quay-dev:quay-file-task` 1** | 0 | 6 | `quay-file-task` 74 | `task_write` 382、`task_list` 319、`task_get` 215、`task_check` 141、`adr_list` 21 | 894 |
| sufficiency judge | 398 | `quay:quay-file-task` 7 | 0 | 0 | 1 | `task_write` 14 等 | 38 |
| architecture-review judge | 291 | 0 | 0 | 0 | 0 | `task_list` 1 | **2,825** |
| criterion-fidelity judge | 184 | 0 | 0 | 0 | 0 | 0 | 67 |
| fresh-context agent | 150 | 0 | 0 | 0 | 0 | 0 | **2,240** |
| pool-quality gate | 60 | 0 | 0 | 0 | 0 | `task_list` 2 | 213 |
| fix worker（promotion-driver） | 38 | 0 | 0 | 1 | 0 | `task_get` 19、`task_write` 10 | 272 |
| 其余（人或其它） | 352 | `quay:quay-file-task` 55、`quay:drivers` 10、`quay:manager-tick-core` 6 | 7（`manager-tick-core` 6、`fan-in-execute` 1） | 111 | 见 §2.2 | `task_get` 445、`task_write` 399、`task_list` 395、`task_check` 172、`lifecycle_retreat` 106、`lifecycle_promote` 34 | 1,325 |

**这张表改变了前面的结论**：

1. **`quay-file-task` 的 Skill 调用主要不是人发的。** 全部 `quay-file-task` 的 Skill 调用约 388 次，其中约 **324（83%）来自 driver 启动的 gap-filing agent**，约 55 来自「其余」（人为主），7 来自 sufficiency judge。**「唯一高频 skill」其实是 goal-driver 的 gap-filing agent 在用。**
2. **driver 启动的会话里没有任何 `Workflow` 调用**（全表 0）；workflow 只出现在「其余」类（`manager-tick-core` 6、`fan-in-execute` 1）。
3. **driver 会话几乎不用 `Skill`，只有 gap-filing agent 与 sufficiency judge 用 `quay-file-task`。** `routines`、`cold-start`、`loop-driver`、`quay-directive`、`init`、`execute`、`manager` 在 driver 会话里的 `Skill` 调用也是 0；它们不是靠 driver 保活的。
4. **driver 会话的主界面是 `plugin/scripts/*`（直接走 Bash）与 `task_*` MCP**：worker 6,814 次、architecture-review judge 2,825 次、fresh-context agent 2,240 次。`instrument` 在 driver 会话里同样是 0。
5. **worker 内几乎不加载 quay skill**，说明 skill 描述对 driver 会话的价值很低；它们是否仍被注入 worker 的上下文，取决于 `launchArgv` 的 `--bare` 与 `--settings`（见下方「未查」）。

**局限与未查**：①类别以首条用户提示判定，`unknown` 类 0 个会话；`goal-sufficiency follow-up agent` 提示出现过 11 次，但在聚合输出里没有对应工具调用，未单独列；②worker 是否实际加载了 plugin 的 skill 清单（`--bare` / `--settings` 的效果）**未查**；③`task-worker-continue`（续做提示）若与 `per-task worker` 开头一致已并入前者，若不一致则没被归类，**未核对**。

### 2.9 meta-cc 读数（不区分人 / driver；全历史；四个项目）

**方法**：人 yale 2026-10-05 要求「不在乎会话是人还是 driver 启动，用 meta-cc 统计调用与读文件」。对 `quay`、`claudecodeui`、`quay-fleet`、`archguard` 各调一次 `query_session_content`（`role=tool`、`block_type=tool_use`、`working_dir=<项目根>`、`scope=project`），用同一个 jq 把每条 `tool_use` 归为 `Skill:<名>` / `Workflow:<名>` / `Agent:<类型>` / `MCP:<动词>` / `ReadSkillMd:<名>`，再 `group_by` 计数。**未查 `meta-cc` 项目本身。**
**交叉验证**：meta-cc 读数与自写扫描（§2.1–2.6，扫全部会话文件）相差 ≤2（例：`quay` 的 `quay:quay-file-task` 两边都是 53；`claudecodeui` 241 vs 242；`quay` 的 `task_get` 555 vs 557）。两条独立路径一致，所以 §2 的相对大小与「是否为 0」可信。meta-cc 的 `include_subagents` 参数按 CLAUDE.md 不生效，但这次计数与扫全层的结果吻合，**未专门验证它是否读了 subagent 层。**

**四个项目合计**：

| 类别 | 项 | 次数（claudecodeui / quay / quay-fleet / archguard） |
|---|---|---|
| 调用最多 | MCP `task_get` | 2,212（1,441 / 557 / 111 / 103） |
| | MCP `task_check` | 1,911（1,149 / 531 / 133 / 98） |
| | MCP `task_write` | 1,516（854 / 424 / 133 / 105） |
| | MCP `task_list` | 840（490 / 260 / 71 / 19） |
| | Skill `quay:quay-file-task` | 358（242 / 53 / 55 / 8） |
| | Agent `quay:quay-task` | 129（43 / 79 / 1 / 6） |
| | MCP `lifecycle_retreat` | 104（73 / 20 / 9 / 2） |
| | MCP `lifecycle_promote` | 34（23 / 10 / 1 / 0） |
| 调用很少 | Skill 无前缀 `quay-file-task` 27、`quay:drivers` 8、`quay:manager-tick-core` 6、`quay:quay-native-methodology` 1、`quay-dev:quay-file-task` 1 | |
| | Workflow `quay:manager-tick-core` 5（另 2 次以脚本文件名形式）、`fan-in-execute.js` 1 | |
| | MCP `adr_list` 21、`lifecycle_complete` 14、`gate_run` 6、`driver_log` 5、`gate_list` 4、`meta_list` 4、`task_delete` 4、`lifecycle_adjudicate` 3，`gate_log` 2，`config_validate`/`action_list`/`goal_get`/`init`/`meta_get` 各 1 | |
| 只读不调用 | `quay-file-task` SKILL.md 读 88（51 / 32 / 5 / 0）；`quay-native-methodology` 读 2；`routines` 读 1；`execute` 读 1；`pool-quality-judge.js` 读 1 | |
| 只在维护 | `quay` 项目内对 plugin 文件的读/编辑：`init/SKILL.md` 12/14、`manager/SKILL.md` 8/8、`drivers/SKILL.md` 2/8、`manager-tick-core.js` 7/4、`cold-start/SKILL.md` 1/2、`loop-driver/SKILL.md` 1/2、`plugin.json` 2/2 | |
| 四个项目里 `Skill`/MCP 均 0 | MCP `action_run`、`adr_get`、`adr_write`、`instrument`、`meta_write`、`task_add_label` | |

**⚠ 这张表对 `init`、`drivers` 有一个盲区，见 §2.10：它们是以斜杠命令被人输入的，`Skill` 与 `Read` 都看不到。**

### 2.10 「全部为 0」的项到底怎么用（初始化、drivers、ADR、plan、goal、directive）

**判定位置**：Bash 命令必须以该命令词开头一个 shell 段（`;` `&&` `|` `(` 之后）才算「执行」，grep/注释/路径中的提及不算；斜杠命令按用户消息里的 `<command-name>/quay:…</command-name>` 计。脚本 `scan6.mjs`（宽）、`scan7.mjs`（严）。
**⚠ 宽严两版相差悬殊（硬规则 2 的实例）**：宽版 `quay-init.sh` 358、`start-drivers` 172；严格「执行」口径分别只有 **21**、**33**。**本节只引用严格口径。** 宽版里 `worker-driver.ts` 1,775、`driver-runtime.ts` 1,598 等是 grep/编辑/阅读，不是执行，作废。

**初始化 quay**

| 路径 | 次数 | 项目 |
|---|---|---|
| 人输入 `/quay:init` | **23** | claudecodeui 16、meta-cc 4、archguard 1、cantus 1、quay-fleet 1 |
| 执行 `bash <plugin 缓存>/scripts/quay-init.sh --root "$(pwd)" --plugin-root <缓存>` | 21 | claudecodeui 5、archguard 4、meta-cc 4、quay 4、cantus 2、quay-fleet 2 |
| `quay init`（CLI） | 3 | 全是 `--help` 或 `--reconcile` 对照（meta-cc 2、claudecodeui 1） |
| MCP `init` | 1 | quay |

⇒ **初始化走的是 `/quay:init` 斜杠命令 → skill → `quay-init.sh`**；CLI `quay init` 与 MCP `init` 几乎不用于真实初始化。`cantus` 是 2026-10-05 新初始化的（`init-commit=2026-10-05`，`tasks=0`）。

**启动 drivers**

| 路径 | 次数 | 项目 |
|---|---|---|
| 人输入 `/quay:drivers` | **15** | quay 6、claudecodeui 5、archguard 2、cantus 2 |
| 执行 `node <缓存>/scripts/dist/start-drivers.js [--root][--host][--port]` | 33 | quay 15、claudecodeui 9、quay-fleet 3、archguard 2、cantus 2、meta-cc 2 |
| `quay driver start/restart`（CLI） | 2 | claudecodeui（`--kind quality`）1、quay-fleet 1 |
| `quay driver status/stop/drain`（CLI） | 110 | claudecodeui 86、meta-cc 12、quay-fleet 9、archguard 2 |
| `quay serve`（CLI） | 21 | claudecodeui 9、quay 7、quay-fleet 3 |

⇒ **启动 drivers 走 `/quay:drivers` → `start-drivers.js`；CLI 主要用于查询状态（`driver status`）。** 这些项目运行的 plugin 缓存版本不一致（0.9.0 / 0.11.0 / 0.14.0 都出现在命令里）。

**斜杠命令**：用户消息里出现的 quay 斜杠命令只有 `/quay:init` 23、`/quay:drivers` 15、`/quay:SKILL` 1（archguard——即 §3.2 的错误注册项被人真的输入过）。**`/quay:execute`、`/quay:manager`、`/quay:cold-start`、`/quay:loop-driver`、`/quay:routines`、`/quay:quay-directive`、`/quay:quay-task-operator`、`/quay:quay-task-to-plan` 等从未被输入。**

**ADR**

| 项 | 读数 |
|---|---|
| 磁盘上的 `adr/ADR-*.md` | quay 36、claudecodeui 5、quay-fleet 4、archguard 0、meta-cc 0 |
| `Read adr/ADR-*.md` | 39（claudecodeui 32、quay 5、meta-cc 2） |
| `Edit` / `Write adr/ADR-*.md` | 22 / 3，**全部在 claudecodeui**（2026-09-21/22） |
| CLI `quay adr …` | 16（claudecodeui 10、meta-cc 6） |
| MCP `adr_list` / `adr_get` / `adr_write` | 21 / 0 / 0 |

⇒ **ADR 在用，但写入是直接 `Write`/`Edit` 文件，不经 `adr_write`；读侧只有 `adr_list`（及 CLI `adr list`）有调用。** meta-cc 的 ADR 在 `docs/architecture/adr/`，其会话里出现过「adr/ 存在且为空」的核对，说明 `adr/` 的约定与该项目的实际目录不一致（未深究）。

**plan / proposal**

| 项 | 读数 |
|---|---|
| 任务体含 `## Plan` 的任务数 | quay 1,299/2,536、claudecodeui 131/427、quay-fleet **185/190**、archguard 26/99、meta-cc 68/113 |
| 任务体含 `## Contract` | quay 442、meta-cc 16、archguard 36，claudecodeui 与 quay-fleet 0 |
| `Read`/`Edit`/`Write docs/plans/*.md` | 3 / 6 / 1，**全在 archguard**（一份 `plan-a4-layer-check.md`） |
| `Read`/`Edit`/`Write docs/proposals/*.md` | 167 / 149 / 18（claudecodeui 156/125/17、archguard 7/23/1、quay 4/1/0） |
| Skill `quay-task-to-plan` / `archguard:feature-developer` | 均 0 |

⇒ **plan 机制在用，但形态是「任务体里的 `## Plan` 段」，经 `task_write` 写入；独立的 `docs/plans/*.md` 与 `quay-task-to-plan` 流水线基本未用。** `docs/proposals/*.md` 在 claudecodeui、archguard 被大量读写，但不是经 `quay-task-to-plan`（0 次）。这些文档由哪个机制产生，**未查**。

**goal**：CLI `quay goal …` 严格口径 **476** 次（quay-fleet 270、claudecodeui 201、quay 3、archguard 2）；MCP 仅 `goal_get` 1 次。`goals/*.md` 数：quay 222、claudecodeui 227、quay-fleet 95、archguard 6、meta-cc 0。
**directive**：`tasks/DIR-*.md` quay 197、meta-cc 98（其 `label:directive` 仅 10，说明 `DIR-` 前缀与标签不完全对应）、archguard 2、quay-fleet 1、claudecodeui 0；`quay-directive` skill `Skill` 0 次，说明 directive 任务是经 `task_write` 直接写的。

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
5. 「`init`、`manager`、`drivers` 有直接 `Read`，所以不属于零证据」：**错误**。这些读取在同一会话里随后都编辑了同一个文件，是维护，不是使用（§2.2 更正）。
6. 「`quay-file-task` 是人最常用的 skill」：**需限定**。约 83% 的调用来自 driver 的 gap-filing agent（§2.8）。
7. 「`init`、`manager` 当前没有任何使用证据」（本 SPEC 早先版本）：**对 `init` 错误**。`init` 与 `drivers` 是以人输入的斜杠命令被使用的（`/quay:init` 23、`/quay:drivers` 15，§2.10），而 `Skill` 工具与 `Read` 都不记录这种调用——**扫描的位置口径漏了一种调用形态**（硬规则 3b：读不懂输入时给出了与「没有」同形的 0）。`manager` 仍无斜杠、`Skill`、非维护读取证据。
8. 「`quay-task-to-plan`、`execute` 等是低频」：这些在 `Skill`、斜杠、非维护读取三种位置均为 0，才可称零证据；此前只核了前者与读取。

---

## 4. 建议（按证据强弱）

### P1　修缺陷（有对照）
- 落地任务 A（删 `commands` 数组）与任务 B（`name:`==目录名并同步旧名引用）。验收以**交互界面读数**为准：重启后输入 `/quay`，`init` 只出现一次且显示为 `/quay:init`。
- 重装用户侧：同名多来源（`quay@quay` + `quay@quay-dev`）是本机配置问题，不属仓库缺陷，但发布说明里应提醒「不要同时启用两个 `quay`」。（依据 §3.1。）

### P2　补 MCP 缺口（有使用记录）
- **依据**：CLI `quay goal …`（严格执行口径，§2.10）476 次（quay-fleet 270、claudecodeui 201），MCP 只有 `goal_get`（1 次）。
- **提议**：确认 `goal write / list / check` 是否应有 MCP 动词；若是故意只留 CLI，应在 plugin 文档里写明，避免 agent 在 MCP 与 CLI 间任意选择。
- **同类**：`quay task edit` CLI 447 次 vs `task_write` MCP 1,529 次，二者并存；是否需要统一，**未调查**。

### P3　压缩常驻上下文（有静态读数，无 token 读数）
- **依据**：§2.7，13 个 skill 描述 6,803 字符 + 6 个 workflow 描述。
- **提议**：优先压缩 `quay-file-task`（高频但 953 字符）、`quay-task-operator`、`quay-directive`、`quay-webui-bootstrap-methodology`、`fan-in-execute`（已退役却是最长的 workflow 描述 1,268 字符）。保持描述内的触发条件与「何时不用」，把过程性内容留在 SKILL.md 正文。
- **前置读数**（建议先取）：skill 清单实际占的 token 与每会话加载频率，再定压缩目标；**不要先设数值目标**（硬规则 4 推论）。

### P4　对零证据 skill 降级，不删除
- **对象（三种位置——`Skill` 调用、人输入的斜杠命令、非维护读取——均为 0）**：`quay-task-operator`、`quay-task-to-plan`、`quay-webui-bootstrap-methodology`、`loop-driver`、`cold-start`、`quay-directive`、`manager`；`execute` 仅 1 次非维护读取。**`init` 与 `drivers` 不在此列**：它们分别有 23 / 15 次斜杠输入（§2.10），是用户面的真实入口，必须保留且保持稳定的名字（`/quay:init`、`/quay:drivers`）。`manager` 降级前须先查 manager 会话是否以文字方式引用它（§2.8 未覆盖）。
- **提议**：保留文件，不在默认安装里自动注入描述（按需加载或内部分发）。具体机制（plugin 拆分、`disable-model-invocation`、或移出 `skills/`）**需要先验证 Claude Code 的支持**，本文未验证。
- **不建议删除的理由**：①`cold-start`、`quay-directive` 在仓库内被脚本/文档引用（引用不等于使用）；②全历史窗口起点未查；③`Skill` 之外还有 §2.3 的两条旁路，旁路读数不完整。
- **留意（已按 §2.2 / §2.8 更正）**：只有 `routines` 因 `run-routines.js` 在代码里把它当提示读，仍属有消费证据，不得并入本类；`drivers` 有 10 次 `Skill` 调用，有使用证据。`init`、`manager` 的直接 `Read` 是维护读取，**不能**当作使用证据，且二者在 driver 会话里的 `Skill` 也是 0——它们当前**没有任何使用证据**，应与 `cold-start`、`loop-driver` 一并按本类评估；但 `init` 是安装流程的入口，是否用 `Skill` 以外的方式触发（如 `quay init` CLI 直接读文件）**未查**，降级前须先查。

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

后续脚本（均为临时文件，可能被清理）：`scan4.mjs` 按首条用户提示把会话归类为 driver 角色，并把 `subagents/`、`workflows/` 归到父会话，产出 §2.8 的表；`scan5.mjs` 对每条 `Read …/skills/<名>/SKILL.md` 核查同会话是否随后 `Edit`/`Write` 同一文件，产出 §2.2 更正表。归类函数按提示固定句式（`resident task selector`、`per-task worker`、`gap-filing agent`、`sufficiency judge`、`architecture-review judge`、`criterion-fidelity judge`、`fresh-conte…`、`pool-quality gate`、`fix worker`、`goal-sufficiency follow-up`）逐个 `includes` 判定。

**已知限制**：①`Skill` 之外的两条旁路只做了脚本与 workflow 的静态检查，未逐个读代码；②`BashQuayCli` 的子命令正则只收录了列出的几个动词，未命中的 CLI 不在表里；③`近期` 窗口只用一个起点（2026-09-21）。

---

## 附录 B：相关任务与改动

- `gap-plugin-json-commands-array-duplicates-skills`（任务 A）：删除 `plugin.json` 的 `commands` 数组。
- `gap-skill-frontmatter-name-align-dirname-for-slash-form`（任务 B）：5 个 skill 的 `name:`==目录名。
- 本机配置（不入库）：`.claude/settings.local.json` 的 `enabledPlugins` 加 `"quay@quay": false`。
- 临时实验副本：`/tmp/quay-plugin-exp/{before,cmdonly,nameonly,after}`（可能被清理）。
