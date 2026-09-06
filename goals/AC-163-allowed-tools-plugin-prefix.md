---
id: AC-163
title: allowed-tools 改 mcp__plugin_quay_quay__* + 静态检查器
status: draft
kind: criterion
goal: GOAL-003
origin: |
  人 2026-09-02 裁定②「同一功能，本项目自己使用的扩展应当与产品交付的是同一个；不应有
  『简化版用于产品交付』」。正本 SPEC-plugin-lifecycle-single-bundle-2026-09-02.md AC2。
---

**判据（能取假）**：全部 `plugin/skills/*/SKILL.md` 的 `allowed-tools` 改为 `mcp__plugin_quay_quay__*`
+ 一个静态检查器（SPEC AC2）。

**取假**：当前 `loop-driver`/`routines` 即红——先红后绿。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。
