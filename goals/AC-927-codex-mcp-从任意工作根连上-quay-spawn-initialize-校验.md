---
id: AC-927
title: Codex MCP 从任意工作根连上 quay：spawn + initialize 校验
status: draft
kind: criterion
goal: GOAL-912
criterion: cd packages/quay && bash ../../plugin/scripts/codex-stage1-spawn-verify.sh
expect: 正向：脚本 exit 0（在子目录 cwd 下 spawn 配置的 quay MCP server 并完成 initialize
  握手，失败非零）；反向：把 .codex/config.toml 的 cwd 改错或改回相对 args，脚本 exit 非 0
origin: 人 2026-10-29 裁定长期支持（SPEC-codex-long-term-support §4.2 AC-927）；证据=本会话 cwd
  实测：server cwd=会话工作根，相对 args 从子目录 ENOENT 且静默
long-term: true
phase: pre-merge
---
