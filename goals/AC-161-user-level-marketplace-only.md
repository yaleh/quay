---
id: AC-161
title: 用户级只留 marketplace 源，启用迁项目级
status: draft
kind: criterion
goal: GOAL-003
origin: |
  人 2026-09-02 裁定③「本项目的开发环境不应污染本机其它项目；仅允许 User Scope 以本项目目录为
  plugin marketplace 源」。正本 SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §4b。
---

**判据（能取假）**：用户级只留 marketplace 源，启用迁项目级（SPEC §4b）。**迁移顺序**：确认已安装 →
项目级置 true → **最后**撤用户级（反序会把自己锁在门外）。判据 SPEC AC5——在**非 quay 项目**起会话，
`PATH` 不含 `<quay>/plugin/bin` **且** `quay:author` NOT-AVAILABLE。

**取假**：当前状态即红（实测 PATH 含该路径两次）。


