---
id: AC-931
title: Codex 插件发布面：.codex-plugin/plugin.json 声明 quay MCP 指向安装后 dist
status: draft
kind: criterion
goal: GOAL-913
criterion: 'if [ ! -f .codex-plugin/plugin.json ]; then echo "FAIL:
  .codex-plugin/plugin.json absent" >&2; exit 1; fi; if ! grep -q quay
  .codex-plugin/plugin.json; then echo "FAIL: no quay MCP declaration" >&2; exit
  1; fi; if grep -q "packages/quay/bin/quay.ts" .codex-plugin/plugin.json; then
  echo "FAIL: dev-tree source path present" >&2; exit 1; fi'
expect: 正向：.codex-plugin/plugin.json 存在、声明 quay MCP server、args 指向安装后
  dist（quay.js mcp），⛔ 不指向 dev-tree source 路径；反向：改成 source 路径或删掉声明后 exit 非 0 且
  stderr 带成因
origin: 人 2026-10-30 裁定：Codex 支持从 dev-tree 走向可安装宿主（发布链对 Codex 零 ship 的补全）
phase: pre-merge
---
