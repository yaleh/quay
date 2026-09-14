---
id: AC-166
title: 第二副本退役 —— .claude 双副本 archive + manager-tick-core 迁入 plugin
status: achieved
kind: criterion
goal: GOAL-003
criterion: >-
  [ -e .claude/workflows/manager-tick-core.js ] && { echo "AC-166 fail:
  .claude/workflows/manager-tick-core.js still exists (second copy not retired)"
  >&2; exit 1; }

  [ -f plugin/workflows/manager-tick-core.js ] || { echo "AC-166 fail:
  plugin/workflows/manager-tick-core.js is missing" >&2; exit 1; }

  [ "$(ls -A .claude/skills 2>/dev/null | wc -l)" = 0 ] || { echo "AC-166 fail:
  .claude/skills is not empty" >&2; exit 1; }

  exit 0
expect: exit 0（.claude/workflows/manager-tick-core.js 已不存在 ∧
  plugin/workflows/manager-tick-core.js 存在 ∧ .claude/skills 已空）
origin: |
  人 2026-09-02 裁定②（自用与交付同一功能）+ 裁定④（manager 是产品一部分）。正本
  SPEC-plugin-lifecycle-single-bundle-2026-09-02.md。
---

**判据（能取假）**：`.claude/skills/` 5 个 + `.claude/workflows/` 双副本 archive；`manager-tick-core.js`
迁入 `plugin/workflows/`（裁定④：manager 是产品一部分）。迁后首个窗口 `quay:manager-tick-core` 调用数
**> 0**（该路径当前承载 608 次/3 天，换文件后必须仍在跑）。

**取假**：迁错路径 ⇒ 恒 0。


