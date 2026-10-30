---
id: AC-932
title: quay init 落 Codex 三件套：.codex/config.toml（项目相对 cwd）+ .agents/skills/ + AGENTS.md
status: draft
kind: criterion
goal: GOAL-913
criterion: 'if ! grep -q "\"\.codex/config\.toml\""
  packages/quay/src/init/delivery-surface.ts; then echo "FAIL: CLOSED_SET_ITEMS
  lacks .codex/config.toml" >&2; exit 1; fi; if ! grep -q "\"\.agents/skills\""
  packages/quay/src/init/delivery-surface.ts; then echo "FAIL: CLOSED_SET_ITEMS
  lacks .agents/skills" >&2; exit 1; fi; if ! grep -q "\"AGENTS\.md\""
  packages/quay/src/init/delivery-surface.ts; then echo "FAIL: CLOSED_SET_ITEMS
  lacks AGENTS.md" >&2; exit 1; fi'
expect: 正向：init/delivery-surface.ts 的 CLOSED_SET_ITEMS 声明 Codex
  三件套（.codex/config.toml / .agents/skills / AGENTS.md）；反向：删掉任一声明 exit 非 0 且
  stderr 带成因。完整行为（quay init 真落盘 + cwd 项目相对）由任务测试承担
origin: 人 2026-10-30 裁定：CLOSED_SET_ITEMS 目前只有 Claude 面，Codex 三件套不 ship
long-term: true
phase: pre-merge
---
