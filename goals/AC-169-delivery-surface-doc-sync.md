---
id: AC-169
title: 交付面与文档同步
status: achieved
kind: criterion
goal: GOAL-003
criterion: >-
  v=$(python3 -c "import
  json;print(json.load(open('plugin/.claude-plugin/plugin.json'))['version'])")

  grep -q "v$v" plugin/README.md || exit 1

  grep -qE 'v0\.4\.0' plugin/README.md && exit 1

  exit 0
expect: exit 0（plugin/README.md 含 plugin.json 的当前版本号 ∧ 不再出现陈旧的 v0.4.0）
origin: |
  人 2026-09-02 裁定①「quay-init 复制 Claude Code 的各种扩展文件的行为应当废弃」。正本
  SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §12e。
---

**判据（能取假）**：交付面与文档同步——`SPEC-complete-delivery-surface` 活文档六类清单、
`CLAUDE.md` 中 quay-init 铺设的描述、`plugin/README.md:3` 仍写 v0.4.0 的散文（实际 0.6.1）。


