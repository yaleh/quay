---
id: gap-publish-dist-branch-does-not-ship-codex-plugin-surface
title: publish-dist-branch.sh 不组装 repo 根 .codex-plugin/ —— AC-931 插件发布面没进 artifact
status: todo
labels:
  - gap
  - release
  - codex
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-931
---
## Finding

AC-931 的 Codex 插件发布面 `.codex-plugin/plugin.json`（声明 `mcpServers.quay = node quay.js mcp`，指向安装后 dist）在 develop 上存在（`git show develop:.codex-plugin/plugin.json` 可读），但**不进 shipped artifact**：2026-10-30 v0.26.0 reanchor 构建的 artifact 实测含 `.codex/AGENTS.md` 却**不含 `.codex-plugin/`**；`claude plugin update` 后 user scope 0.27.0-dev 也只有 `.codex/` 无 `.codex-plugin/`。AC-931 验的是「文件在 develop 存在」，但「文件随发布 ship」这条链在 publish-dist-branch.sh 断了——它组装的是 plugin/ + .claude-plugin/，没有把 repo 根的 `.codex-plugin/` 组装进 artifact。

## Requested action

修 `publish-dist-branch.sh`（或 shipped-set 的组装面），把 repo 根的 `.codex-plugin/`（Codex 插件发布面）随发布组装进 artifact，使 `claude plugin update` 后的 user scope 含 `.codex-plugin/plugin.json`。

## Acceptance Criteria

- [ ] 发布 artifact（publish-dist-branch.sh 组装 + git archive）含 `.codex-plugin/plugin.json`。
- [ ] `.codex-plugin/plugin.json` 里的 `mcpServers.quay.args` 指向安装后 dist（`quay.js mcp`），非 dev-tree source 路径。
- [ ] 现有 shipped-set 尺寸检查与该组装兼容（reanchor 若需，记录 before/after）。

## Definition of Done

修复落地 develop；publish-plugin-dist 后 user scope 含 `.codex-plugin/plugin.json`，Codex 插件发布面真正可安装。

该轴仍暗,理由:发布组装缺陷修复，无组件代码改动（只改 publish-dist-branch.sh 组装面），未跑 archguard/码文档比测量

## Touches

- tasks/gap-publish-dist-branch-does-not-ship-codex-plugin-surface.md
- plugin/scripts/publish-dist-branch.sh