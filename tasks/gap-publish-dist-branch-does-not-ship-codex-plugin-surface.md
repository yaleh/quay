---
id: gap-publish-dist-branch-does-not-ship-codex-plugin-surface
title: publish-dist-branch.sh 不组装 repo 根 .codex-plugin/ —— AC-931 插件发布面没进 artifact
status: done
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

- [x] 发布 artifact（publish-dist-branch.sh 组装 + git archive）含 `.codex-plugin/plugin.json`。
- [x] `.codex-plugin/plugin.json` 里的 `mcpServers.quay.args` 指向安装后 dist（`quay.js mcp`），非 dev-tree source 路径。
- [x] 现有 shipped-set 尺寸检查与该组装兼容（reanchor 若需，记录 before/after）。

## Definition of Done

修复落地 develop；publish-plugin-dist 后 user scope 含 `.codex-plugin/plugin.json`，Codex 插件发布面真正可安装。

## ADR-007 dark-axis record

该轴仍暗,理由:发布组装缺陷修复，无组件代码改动（只改 publish-dist-branch.sh 组装面 + 三个发布测试桩 + sh-census 棘轮基线），未跑 archguard/码文档比测量

## Evidence

- AC1：throwaway stub 里跑真实 `publish-dist-branch.sh --no-build` + `git archive` 解包后，artifact 根含 `.codex-plugin/plugin.json`（负控：未改前的脚本组装不出该文件）。
- AC2：`.codex-plugin/plugin.json` 的 `mcpServers.quay.args = ["quay.js","mcp"]`，`grep -c 'packages/quay/bin/quay.ts' .codex-plugin/plugin.json` = 0；`plugin/test/codex-plugin-surface.test.mjs` 正向 + 三个负控全绿。
- AC3：shipped-set 基线已由前序提交 394c5d184 reanchor 为 files 302→303（before/after 已记录，+1 = `.codex-plugin/plugin.json`，shLines 不变）；本改动只增 1 个 JSON 文件、0 条 .sh 行，尺寸检查兼容。`shipped-set.test.mjs` / `shipped-shell-reachability.test.mjs` / `publish-dist-branch-closure-gate.test.mjs` / `sh-census-check.test.mjs` 共 50 项测试全绿（pass 50 / fail 0）。

## Touches

- tasks/gap-publish-dist-branch-does-not-ship-codex-plugin-surface.md
- plugin/scripts/publish-dist-branch.sh
- plugin/sh-census-baseline.json
- plugin/test/shipped-set.test.mjs
- plugin/test/shipped-shell-reachability.test.mjs
- plugin/test/publish-dist-branch-closure-gate.test.mjs