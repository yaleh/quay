---
id: gap-ac165-remove-root-mcp-json-quay-entry
title: AC165 撤 root .mcp.json 的 quay 条目 + settings.local 的 enabledMcpjsonServers
  去 quay
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-165
---
## Proposal

**目标态（人 2026-09-02 裁定② + SPEC §7 #4 + GOAL-003 AC-165）**：root `.mcp.json` 的 `mcpServers` 不再含 `quay` 键，且 `.claude/settings.local.json` 的 `enabledMcpjsonServers` 不再含 `"quay"`——「本项目用的路径 ≠ 交付路径」的唯一来源就此消失（裁定 2）。permission allowlist 同步把裸 `mcp__quay__*` 改成 `mcp__plugin_quay_quay__*`（AC-165 记录正文「permission allowlist 同步改插件前缀名」）。

**先接已做（硬前置已满足，立案当轮实测，非推断）**：AC-164 `status: achieved`、`evidence.verdict: pass`（24h 窗口 `mcp__plugin_quay_quay__*` 真调用 > `mcp__quay__*`）——插件命名空间已承接生产流量；`plugin/.mcp.json` 存在并服务 `mcp__plugin_quay_quay__*`。故现在撤裸不会断流（§11a-① 先接后撤的「接」已由 AC164 完成）。

**当前状态（立案当轮实测）**：
- `.mcp.json`（git 跟踪）`mcpServers.quay` = `node packages/quay/bin/quay.ts mcp`——源码路径，与插件 vendored dist 是两条路径。
- `.claude/settings.local.json`（gitignored）`enabledMcpjsonServers` 含 `"quay"`；`permissions.allow` 含 `mcp__quay__task_get` / `mcp__quay__gate_log`（裸命名空间）。
- AC-165 `evidence.verdict: fail`（exit 1）。

**迁移步骤（顺序：接已完成，本步只撤裸）**：
1. 编辑 `.mcp.json`：删 `mcpServers.quay` 键，留 `{"mcpServers": {}}`。⛔ 文件必须保留且为合法 JSON——criterion 的 `json.load(open('.mcp.json'))` 遇缺文件/坏 JSON 会抛异常 ⇒ 非零退出 ⇒ 判 fail（「撤了但文件没了」= 判据崩溃，与「没撤」同形）。
2. 编辑 `.claude/settings.local.json`：`enabledMcpjsonServers` 删 `"quay"`（保留 `plugin:meta-cc:meta-cc` / `plugin:archguard:archguard` / `meta-cc` / `archguard`）；`permissions.allow` 的 `mcp__quay__task_get` → `mcp__plugin_quay_quay__task_get`、`mcp__quay__gate_log` → `mcp__plugin_quay_quay__gate_log`。
3. 跑 AC-165 criterion 整段确认 exit 0；负控制：临时加回 `quay` 键 ⇒ exit 1，撤掉 ⇒ 回 exit 0。

**关联（机制去重后单列，本任务不越界）**：AC-163（allowed-tools 裸名改前缀）改的是 `plugin/skills/*/SKILL.md` 内工具名，本任务改的是 root `.mcp.json` 与 `.claude/settings.local.json` 的裸命名空间——不同文件、不同判据，勿当重复。

## AC

- [x] AC-165 判据逐字 exit 0：python3 跑 `goals/AC-165-remove-root-mcp-json.md` 里 criterion 的 heredoc，退出码 0
- [x] `.mcp.json` 保留且合法 JSON 且无 quay 键：`test -f .mcp.json && python3 -c 'import json;d=json.load(open(".mcp.json"));assert "quay" not in (d.get("mcpServers") or {})'` exit 0
- [x] `.claude/settings.local.json` enabledMcpjsonServers 无 "quay"：`python3 -c 'import json;d=json.load(open(".claude/settings.local.json"));assert "quay" not in (d.get("enabledMcpjsonServers") or [])'` exit 0
- [x] permission allowlist 无裸命名空间残留：`grep -n "mcp__quay__" .claude/settings.local.json` 输出为空，且 `grep -qE "mcp__plugin_quay_quay__(task_get|gate_log)" .claude/settings.local.json` exit 0
- [x] 负控制（能取假）：临时把 `quay` 加回 `.mcp.json` mcpServers ⇒ AC-165 criterion exit 1；撤掉 ⇒ 回 exit 0（两次读数入任务体 Evidence）

## Evidence

AC-165 criterion 逐字 + 负控制读数（2026-09-07 落地轮实际执行，两文件取目标态后跑 heredoc）：

- **AC-1 判据逐字**：目标态两文件（`.mcp.json` 无 quay 键、`.claude/settings.local.json` enabledMcpjsonServers 无 "quay"）下跑 criterion heredoc ⇒ **exit 0**。
- **负控制（加回 quay）**：`.mcp.json` 临时写回 `mcpServers.quay` ⇒ criterion ⇒ **exit 1**。
- **恢复**：`.mcp.json` 撤掉 quay ⇒ criterion ⇒ **exit 0**。
- 附带：`grep -n "mcp__quay__" .claude/settings.local.json` 输出为空；`grep -qE "mcp__plugin_quay_quay__(task_get|gate_log)" .claude/settings.local.json` exit 0。

## DoD

AC-165 的 criterion 整段在本任务落地轮**实际执行且 exit 0**——即 goal-driver 下一轮读到的 `evidence.verdict` 由 fail 翻 pass（读 `.quay/goal-round.jsonl` 该 AC 的 verdict），而不是只在任务体里贴「判据应绿」的散文。`.mcp.json` 保留且无 quay 键、`.claude/settings.local.json` 无裸 quay 命名空间、permission allowlist 已改插件前缀；负控制「加回 quay 即红」实际执行过一次并留读数。⛔ 只改 `.mcp.json` 而 `.claude/settings.local.json` 仍含 `"quay"` ⇒ 判据仍红 ⇒ 不算达成。

## Touches

- .mcp.json
- .claude/settings.local.json
- tasks/gap-ac165-remove-root-mcp-json-quay-entry.md