---
id: gap-skill-allowed-tools-plugin-namespace
title: plugin/skills 的 allowed-tools 写裸名 mcp__quay__*
  对任何受支持渠道都不生效（loop-driver/routines 两处），且无恒定判据——AC163，AC165 撤裸命名空间的硬前置
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §3c 的查证结论：`allowed-tools` 是
**精确字符串匹配、无前缀别名**——`mcp__quay__x` 与 `mcp__plugin_quay_quay__x` 永远是两个名字，
插件内 skill 引用裸名「never fires」（官方文档原话）。它是**软预批准而非能力限制**：没匹配上退回正常权限确认，不是功能失效。

**实测现状**：`plugin/skills/loop-driver/SKILL.md` 与 `plugin/skills/routines/SKILL.md` 的 `allowed-tools` 写的是裸名
`mcp__quay__*`，而 `plugin/scripts/quay-init.sh` **全文不写任何 `.mcp.json`**（grep 零命中）
⇒ 正确 onboard 的下游项目里**只有** `mcp__plugin_quay_quay__*`
⇒ **那份裸名单对任何受支持渠道都不生效**，只在本开发机被多余的 root `.mcp.json` 意外兜住
（正因为在本机被兜住，它从未表现为故障——这正是"存在≠生效"的典型形态）。

本任务 = 阶段 AC163，**是 AC165（撤 root `.mcp.json` 的 quay 条目）的硬前置**：
SPEC §11a-① 实测三天生产流量 `mcp__quay__*` 178 次 vs `mcp__plugin_quay_quay__*` 6 次，97% 在计划退役的命名空间上
⇒ 退它不是清理而是**主干路径搬家**，必须**先接后撤**，⛔ 不得先撤后接。

**为什么必须配一个检查器而不只是改两行**：改完两处，下一个 skill 作者照样会写裸名，
而"守"与"不守"在记录上无法区分（硬规则 9）⇒ 该给它造产物，不是把纪律写得更醒目。
这也正是 SPEC 不变式 AC2 的内容（*能取假*：当前状态即红——先红后绿，不是恒绿）。

## AC

- [x] AC1 改前先打印（引用计数前先打印命中内容）：把 `plugin/skills/loop-driver/SKILL.md` 与 `plugin/skills/routines/SKILL.md` 当前的 `allowed-tools` 行**原文**贴进本任务体，再改写其中 `mcp__quay__*` 形式为 `mcp__plugin_quay_quay__*`。
- [x] AC2 恒定判据：新增 `plugin/scripts/skill-allowed-tools-namespace-check.ts`，判定 `plugin/skills/*/SKILL.md` 中出现的 `mcp__` 工具名**全部**为 `mcp__plugin_quay_quay__*` 形式；**按位置判定**（`allowed-tools` 字段值），散文与注释里的提及不算命中（硬规则 2）。
- [x] AC3 三次读数、双向取假：改前跑必须**红且逐字点名那两个文件**；改后必须绿；把任一处写回裸名必须**再红**。三次读数逐条入任务体（只做"改后绿"一次读数不算——那不能区分"检查器有效"与"检查器恒绿"）。
- [x] AC4 接线并绿：检查器接进套件静态检查注册表（CODE-CLASS 走 `plugin/scripts/runner-static-gate.ts` 的 `run_static_checks`；若判为 DOC-CLASS 则走 `scripts/test.sh` 的 `run_doc_checks`），并在本任务落地轮**实际执行且绿**。

## DoD

检查器已在一轮真实套件里跑过并绿（不是只有脚本文件与单测），且 AC3 的"写回裸名即红"负控制**实际执行过一次**并留读数；
两个 SKILL.md 的 `allowed-tools` 在 develop 上可见为插件前缀形式。
⛔ 只改两个 SKILL.md 而无恒定判据不算达成——那正是硬规则 9 说的、守与不守在记录上无法区分的状态。

## Evidence

**AC1 改前原文（贴自两文件的 `allowed-tools` 行，改前 grep 打印）**：

`plugin/skills/loop-driver/SKILL.md:4`（12 个裸 `mcp__quay__` 工具名）：
```
allowed-tools: Bash, Read, mcp__quay__task_list, mcp__quay__task_get, mcp__quay__task_write, mcp__quay__gate_run, mcp__quay__gate_log, mcp__quay__lifecycle_complete, mcp__quay__lifecycle_promote, mcp__quay__lifecycle_retreat, mcp__quay__lifecycle_adjudicate, mcp__quay__action_list, mcp__quay__action_run, mcp__quay__task_check
```

`plugin/skills/routines/SKILL.md:4`（3 个裸 `mcp__quay__` 工具名）：
```
allowed-tools: Bash, Read, Write, TaskCreate, TaskUpdate, TaskGet, TaskList, SendMessage, Skill, mcp__quay__task_get, mcp__quay__task_list, mcp__quay__task_write
```

**改后**：两行全部改写为 `mcp__plugin_quay_quay__*` 前缀（loop-driver 12 个、routines 3 个工具名逐个替换），
改后 `grep -c 'mcp__quay__'` 两文件均为 0。

**AC3 三次读数（双向取假，逐条留痕）**：

| # | 状态 | 命令结果 | exit |
|---|---|---|---|
| 1 改前 | 两文件均为裸名 | 红，逐字点名 `plugin/skills/loop-driver/SKILL.md`（12 个工具名）与 `plugin/skills/routines/SKILL.md`（3 个工具名） | 1 |
| 2 改后 | 两文件均插件前缀 | 绿：`PASS: all 12 SKILL.md with allowed-tools use the mcp__plugin_quay_quay__* namespace (0 violation(s))` | 0 |
| 3 写回裸名 | loop-driver 写回裸名（routines 保持插件前缀） | 红，只点名 `plugin/skills/loop-driver/SKILL.md`（12 个工具名） | 1 |

读法：`node --no-warnings --experimental-strip-types plugin/scripts/skill-allowed-tools-namespace-check.ts --root <worktree>`。
读数 3 后恢复 loop-driver 插件前缀，末次读数回到绿（exit 0）。

**AC4 接线并绿**：检查器注册进 `run_static_checks`（CODE-CLASS，`@static-tier change` + `@static-object plugin/skills/** …`）。
本任务落地轮已实际执行：`checker-mechanical-spine-check`（119 checkers，0 violations）、
`capability-catalog.sh --summary`（310 scripts / 310 declared / 0 unclassified，entry-gate 绿）、
`checker-mutation-check.sh --list`（59 checkers 全覆盖，`skill-allowed-tools-namespace-check` covered=yes）、
`node --test plugin/test/skill-allowed-tools-namespace-check.test.mjs`（9/9 绿）。

## Touches

- plugin/skills/loop-driver/SKILL.md（allowed-tools 裸名改插件前缀）
- plugin/skills/routines/SKILL.md（同上）
- plugin/scripts/skill-allowed-tools-namespace-check.ts（新，恒定判据）
- plugin/scripts/capability-catalog.sh（新脚本六表注册）
- plugin/scripts/runner-static-gate.ts（CODE-CLASS 静态检查注册表接线）
- plugin/test/skill-allowed-tools-namespace-check.test.mjs（新，含写回裸名即红的负控制）
- plugin/scripts/checker-mutation-cases/skill-allowed-tools-namespace-check.sh（新，mutation case，checker-mutation-check AC1b 强制）
- tasks/gap-skill-allowed-tools-plugin-namespace.md（自身）
