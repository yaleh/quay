---
id: gap-codex-mcp-json-source-collides-with-claude-project-config
title: codex .mcp.json 源与 Claude Code 项目 .mcp.json 碰撞：源移到 .codex-plugin/、publish
  单独拷到 artifact 根、repo 根回空（AC-165 原则回归修复）
status: todo
labels:
  - gap
  - codex
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

回归修复：`gap-codex-plugin-mcp-json-nested-in-wrong-level` 把 codex 插件的 `.mcp.json`（`args: ["~/.local/share/quay/quay.js", "mcp"]`）写进了 **repo 根 `.mcp.json`**，违背了 `gap-ac165-remove-root-mcp-json-quay-entry`（done，人 2026-09-02 裁定）早已确立的原则——「root `.mcp.json` 的 `mcpServers` 不再含 `quay` 键」。

后果（2026-10-31 实测）：Claude Code 读 repo 根 `.mcp.json` 当**项目级 MCP config**，直接 spawn node（不经 shell、`~` 不展开）→ `node '~/.local/share/quay/quay.js'` ENOENT → 本会话 quay MCP 死（CONNECTION_CLOSED，`ps` 无 yale 的 quay MCP 进程）。即时恢复已把 `.mcp.json` 改回空（工作树未提交），MCP 重连后恢复。

根因：repo 根 `.mcp.json` 同时被两个宿主按**不同展开规则**读——Claude Code 直接 spawn（要绝对路径/占位符），codex 走 `codex-mcp-sync.sh` 的 `~`→`$HOME` 展开（要可移植模板）。一个文件服务不了两个宿主。

修复（分离，人 2026-10-31 裁定）：
1. repo 根 `.mcp.json` 回空 `{"mcpServers": {}}`（Claude Code 项目 config 归 AC-165 状态；quay MCP 靠插件级 `plugin/.mcp.json` 的 `${CLAUDE_PLUGIN_ROOT}`）。
2. codex `.mcp.json` 源移到 **`.codex-plugin/.mcp.json`**（含 `~` 可移植模板）。
3. `publish-dist-branch.sh` 组装时：rsync `.codex-plugin/` **排除 `.mcp.json`**，单独把它拷到 **artifact 根** `.mcp.json`（codex 插件需要的 `.codex-plugin/` 兄弟位置）。

merge-candidate：`peers: []`。前驱：`gap-ac165-remove-root-mcp-json-quay-entry`（原则）、`gap-codex-plugin-mcp-json-nested-in-wrong-level`（回归源）。

## Acceptance Criteria

- [ ] AC1 布局（按位置）：repo 根 `.mcp.json` == `{"mcpServers": {}}`（无 quay 键，合法 JSON）；`.codex-plugin/.mcp.json` 存在且 `args[0]` == `"~/.local/share/quay/quay.js"`（可移植模板，含 `~`）。贴两文件全文。
- [ ] AC2 组装：`publish-dist-branch.sh` 组装出的 artifact 里，`.codex-plugin/` 内**只有 `plugin.json`**（无 `.mcp.json`），且 artifact **根** `.mcp.json` == codex 源（`~` 模板）。贴组装产物 `find` 结果 + 两处 `.mcp.json` 内容。
- [ ] AC3 codex 回归验证（复用前任务 AC）：从组装 artifact 组 marketplace → `codex plugin add quay@<mkt>` → `codex mcp list`（中立 /tmp）出现 quay → 从 meta-cc `codex exec` 调 `task_list` 返回任务（贴 `codex plugin list`、`codex mcp list`、最终报告）。
- [ ] AC4 Claude Code 回归验证（能取假）：repo 根 `.mcp.json` 为空时 Claude Code 的 quay MCP 由插件级 `plugin/.mcp.json`（`${CLAUDE_PLUGIN_ROOT}`）提供——`grep -q 'CLAUDE_PLUGIN_ROOT' plugin/.mcp.json` exit 0 且 repo 根 `.mcp.json` 无 `quay`；反向：临时把 `~` 模板写回 repo 根 `.mcp.json` ⇒ `node '~/.local/share/quay/quay.js' --version` ENOENT（证明该形态不能被 Claude Code 直接 spawn；还原后复绿）。
- [ ] AC5 测试+范围门：`plugin/test/codex-plugin-surface.test.mjs` 断言新布局（`.codex-plugin/.mcp.json` 为源 + repo 根 `.mcp.json` 空）；反向两处各打红一次；`bash scripts/test.sh --for-task gap-codex-mcp-json-source-collides-with-claude-project-config --allow-thin` 绿。

## Definition of Done

repo 根 `.mcp.json` 回空（AC-165 原则恢复）、codex 源在 `.codex-plugin/.mcp.json`、publish 组装把源单独拷到 artifact 根（`.codex-plugin/` 内不再有 `.mcp.json`）；codex 插件从 shipped artifact 直接装后 `codex mcp list` 出现 quay 且 meta-cc task_list 通过；Claude Code 的 quay MCP 由插件级 `${CLAUDE_PLUGIN_ROOT}` 提供、repo 根空；反向两处打红；范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:.mcp.json 源搬移 + 组装脚本 rsync 排除/单独拷贝,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- .mcp.json
- .codex-plugin/.mcp.json
- .codex-plugin/plugin.json
- plugin/scripts/publish-dist-branch.sh
- plugin/test/codex-plugin-surface.test.mjs
- plugin/test/publish-dist-branch-closure-gate.test.mjs
- tasks/gap-codex-mcp-json-source-collides-with-claude-project-config.md
