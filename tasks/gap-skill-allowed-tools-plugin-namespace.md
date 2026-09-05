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

- [ ] AC1 改前先打印（引用计数前先打印命中内容）：把 `plugin/skills/loop-driver/SKILL.md` 与 `plugin/skills/routines/SKILL.md` 当前的 `allowed-tools` 行**原文**贴进本任务体，再改写其中 `mcp__quay__*` 形式为 `mcp__plugin_quay_quay__*`。
- [ ] AC2 恒定判据：新增 `plugin/scripts/skill-allowed-tools-namespace-check.ts`，判定 `plugin/skills/*/SKILL.md` 中出现的 `mcp__` 工具名**全部**为 `mcp__plugin_quay_quay__*` 形式；**按位置判定**（`allowed-tools` 字段值），散文与注释里的提及不算命中（硬规则 2）。
- [ ] AC3 三次读数、双向取假：改前跑必须**红且逐字点名那两个文件**；改后必须绿；把任一处写回裸名必须**再红**。三次读数逐条入任务体（只做"改后绿"一次读数不算——那不能区分"检查器有效"与"检查器恒绿"）。
- [ ] AC4 接线并绿：检查器接进套件静态检查注册表（CODE-CLASS 走 `plugin/scripts/runner-static-gate.ts` 的 `run_static_checks`；若判为 DOC-CLASS 则走 `scripts/test.sh` 的 `run_doc_checks`），并在本任务落地轮**实际执行且绿**。

## DoD

检查器已在一轮真实套件里跑过并绿（不是只有脚本文件与单测），且 AC3 的"写回裸名即红"负控制**实际执行过一次**并留读数；
两个 SKILL.md 的 `allowed-tools` 在 develop 上可见为插件前缀形式。
⛔ 只改两个 SKILL.md 而无恒定判据不算达成——那正是硬规则 9 说的、守与不守在记录上无法区分的状态。

## Touches

- plugin/skills/loop-driver/SKILL.md（allowed-tools 裸名改插件前缀）
- plugin/skills/routines/SKILL.md（同上）
- plugin/scripts/skill-allowed-tools-namespace-check.ts（新，恒定判据）
- plugin/scripts/capability-catalog.sh（新脚本六表注册）
- plugin/scripts/runner-static-gate.ts（CODE-CLASS 静态检查注册表接线）
- plugin/test/skill-allowed-tools-namespace-check.test.mjs（新，含写回裸名即红的负控制）
- tasks/gap-skill-allowed-tools-plugin-namespace.md（自身）
