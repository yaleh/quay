---
id: AC-932
title: quay init 落 Codex 三件套：.codex/config.toml（项目相对 cwd）+ .agents/skills/ + AGENTS.md
status: draft
kind: criterion
goal: GOAL-913
criterion: node --test plugin/test/quay-init-codex-laydown.test.mjs
expect: 正向：测试断言 quay init 在干净 fixture 里落三件套，且 config 的 cwd 是项目相对/占位符填充，⛔
  无宿主绝对路径；反向：去掉 laydown 或塞回绝对路径后测试红
origin: 人 2026-10-30 裁定：CLOSED_SET_ITEMS 目前只有 Claude 面，Codex 三件套不 ship
long-term: true
phase: pre-merge
---
