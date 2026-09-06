---
id: AC-164
title: 插件命名空间承接生产流量
status: draft
kind: criterion
goal: GOAL-003
origin: |
  人 2026-09-02 裁定②「本项目自己使用的扩展应当与产品交付的是同一个」。正本
  SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §4（顺序不可颠倒——它承载 3 天 178 次生产流量）。
---

**判据（能取假）**：迁移后一个观测窗口内 `mcp__plugin_quay_quay__*` 调用数 **>** `mcp__quay__*`
（当前是 6 : 178，方向相反）。

**取假**：不迁就不会翻转。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。
