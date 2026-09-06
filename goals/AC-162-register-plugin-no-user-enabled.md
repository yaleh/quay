---
id: AC-162
title: register-plugin.mjs 不再写用户级 enabledPlugins
status: draft
kind: criterion
goal: GOAL-003
origin: |
  人 2026-09-02 裁定③「本项目的开发环境不应污染本机其它项目」。正本
  SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §4b。
---

**判据（能取假）**：`register-plugin.mjs` 不再写用户级 `enabledPlugins`（安装可以全局，启用不该全局）。

**取假**：跑一次全局安装后 `grep enabledPlugins ~/.claude/settings.json` 仍出现 quay ⇒ 未改。


