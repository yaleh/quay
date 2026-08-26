---
id: gap-driver-drain-no-inverse
title: quay driver drain 无逆操作——drain+stop 后无表层通道解闸，start 遇 halted 静默进 respawn 循环（硬规则 3b 同形）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`quay driver` 的 `drain` 没有逆操作（manager 报，我读码复核）：

- `drain` 写 `<kind>-control.json` `halted:true`（`driver-runtime.ts:1004 applyHalt(state, "quay-driver-drain", true)`），纯文件操作、driver 停着也能写；
- 逆向（`halted:false`）只有 MCP `halt` 工具（`driver-shared.ts:287-307`），而该 MCP server 跑在 driver 进程**内部**（`serveControlPlane :255 ← worker-driver.ts:63`）；
- `cli/driver.ts:29` VERBS = `["start","stop","drain","status","restart"]` —— **无 resume / drain --off**。

**⇒ 一旦 `drain` 之后 `stop`，就没有任何表层通道能解闸**；而 `start` 起来会立刻读到 `halted` 再停（实测 03:33:05Z + 03:33:11Z 两条 `stop_reason: mcp-halt` + supervisor `respawning driver in 5s` ⇒ **进 respawn 循环**）。manager 的绕法是 `applyHalt(state,"manager",false) + writeControlState`（⛔ 不手改 JSON），但这要求操作者读得懂内部导出——不是表层。

**形状**：一个只能进不能出的闸，且「出不去」表现为 respawn 循环而非明确报错（硬规则 3b 同形——「读不懂输入时不得返回与合格同形的值」，这里是「起不来却表现为正在重启」）。

## Plan

加 `drain` 的逆操作 + start 遇 halted 的明确行为：
1. `quay driver resume --kind <k>`（或 `drain --off`）解 halted 闸；
2. `start` 遇 `halted:true` 应**明确拒绝并提示解闸命令**，⛔ 不静默进 respawn 循环（respawn 循环与「driver 起不来」同形，硬规则 3b）。

## Acceptance Criteria

- [ ] AC1（能取假，drain 有逆操作）：`quay driver resume --kind <k>`（或 `drain --off`）把 halted:false 写回，drain+stop 后能通过表层恢复 driver；（⛔ 仍无逆操作、需读内部导出 ⇒ 假）。
- [ ] AC2（能取假，start 遇 halted 明确拒绝）：`start` 遇 `halted:true` 明确报错并提示解闸命令（退出码非 0 / 明确 message），⛔ 不静默进 respawn 循环；（⛔ 仍静默 respawn ⇒ 假）。

## Definition of Done

drain 逆操作落地 + start 遇 halted 明确拒绝；AC1-AC2 全勾；drain+stop 后能表层恢复、不再 respawn 循环。

## Touches

- packages/quay/src/cli/driver.ts（VERBS 加 resume / drain --off）
- plugin/scripts/driver-runtime.ts（applyHalt false 的表层入口）
- plugin/scripts/worker-driver.ts（start 遇 halted 的明确拒绝分支，⛔ 不 respawn）
- tasks/gap-driver-drain-no-inverse.md（自身）
