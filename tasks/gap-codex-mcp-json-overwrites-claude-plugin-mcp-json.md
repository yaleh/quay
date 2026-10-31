---
id: gap-codex-mcp-json-overwrites-claude-plugin-mcp-json
title: codex .mcp.json 覆盖 artifact 根 Claude Code .mcp.json：publish 不再把 codex 源写到
  artifact 根（peer 报 plugin:quay:quay CONNECTION_CLOSED）
status: done
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

前驱 `gap-codex-mcp-json-source-collides-with-claude-project-config`（done）修了 **REPO 源**碰撞（repo 根 `.mcp.json` 回空、codex 源移 `.codex-plugin/.mcp.json`），但 **publish 组装仍把 codex `.mcp.json` 拷到 artifact 根**，覆盖了 Claude Code 插件级 `plugin/.mcp.json`（`${CLAUDE_PLUGIN_ROOT}`、`{"quay":…}` 格式）。

后果（claudecodeui peer 2026-10-31 实测）：0.29.0 已装插件的 `.mcp.json` = codex 版（`{"mcpServers":…}` + `~/.local/share/quay/quay.js`）→ Claude Code harness 直接 spawn node、`~` 不展开 → **`plugin:quay:quay` CONNECTION_CLOSED**（重启也连不上）。peer 已本地热修（改绝对路径），但那在版本化缓存里、下次升级被覆盖。

根因：Claude Code 和 codex 的 `.mcp.json` **都在 artifact 根同一个路径**，内容互斥（一个要 `${CLAUDE_PLUGIN_ROOT}`、一个要 `~` 模板 + `codex-mcp-sync` 展开）。一个文件服务不了两个宿主。

正解（人 2026-10-31 裁定）：artifact 根 `.mcp.json` **归 Claude Code**（来自 `plugin/.mcp.json`，`${CLAUDE_PLUGIN_ROOT}`）；codex `.mcp.json` 源留在 `.codex-plugin/.mcp.json`，由 codex marketplace 构建面单独消费，⛔ 不写进 Claude Code artifact。merge-candidate：`peers: []`。

## Acceptance Criteria

- [x] AC1 artifact 根 `.mcp.json` 归 Claude Code：`publish-dist-branch.sh` 组装产物里 `grep -q 'CLAUDE_PLUGIN_ROOT' <artifact>/.mcp.json` exit 0 且 `grep -q 'local/share/quay' <artifact>/.mcp.json` exit 1（贴 `.mcp.json` 全文）。
- [x] AC2 codex 源仍在且不写 artifact 根：`.codex-plugin/.mcp.json` 存在（`~` 模板），publish 组装产物 artifact 根 `.mcp.json` 无 codex 内容、`.codex-plugin/` 内只有 `plugin.json`（贴 `find` 结果）。
- [x] AC3 Claude Code 回归：从 assembled artifact 装 Claude Code 插件后，`plugin:quay:quay` 的 args = `${CLAUDE_PLUGIN_ROOT}/vendor/quay/dist/quay.js`（读已装插件 `.mcp.json`，非 `~`/绝对 codex 路径）。
- [x] AC4 codex 回归：codex marketplace 从 `.codex-plugin/.mcp.json` 组 → `codex plugin add quay@<mkt>` → `codex mcp list`（中立 /tmp）有 quay → 从 meta-cc `codex exec` task_list 通（贴两处运行）。
- [x] AC5 反向（能取假）：临时把 codex 源拷回 artifact 根 ⇒ artifact `.mcp.json` 变 codex `~`（`grep -q 'local/share/quay'` exit 0）；还原后复绿。
- [x] AC6 测试+范围门：`plugin/test/codex-plugin-surface.test.mjs`（或 `publish-dist-branch-closure-gate.test.mjs`）断言 artifact 根 `.mcp.json` 是 Claude Code 版、codex 源不覆盖；`bash scripts/test.sh --for-task gap-codex-mcp-json-overwrites-claude-plugin-mcp-json --allow-thin` 绿。

## Definition of Done

artifact 根 `.mcp.json` 归 Claude Code（`${CLAUDE_PLUGIN_ROOT}`）、codex `.mcp.json` 源留在 `.codex-plugin/` 且不写 artifact 根；两宿主各自可用（Claude Code `plugin:quay:quay` 连上、codex mcp list + task_list 通）；反向打红；范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:publish 组装不再把 codex .mcp.json 写到 artifact 根,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- plugin/scripts/publish-dist-branch.sh
- .codex-plugin/.mcp.json
- plugin/test/codex-plugin-surface.test.mjs
- plugin/test/publish-dist-branch-closure-gate.test.mjs
- tasks/gap-codex-mcp-json-overwrites-claude-plugin-mcp-json.md
