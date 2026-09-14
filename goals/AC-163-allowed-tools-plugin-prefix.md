---
id: AC-163
title: allowed-tools 改 mcp__plugin_quay_quay__* + 静态检查器
status: achieved
kind: criterion
goal: GOAL-003
criterion: >-
  grep -h '^allowed-tools:' plugin/skills/*/SKILL.md 2>/dev/null | grep -q
  'mcp__quay__' && { echo "AC-163 fail: a plugin/skills/*/SKILL.md allowed-tools
  line still uses the bare mcp__quay__ prefix" >&2; exit 1; }

  node --experimental-strip-types
  plugin/scripts/allowed-tools-plugin-prefix-check.ts >/dev/null 2>&1 || { echo
  "AC-163 fail: static checker
  plugin/scripts/allowed-tools-plugin-prefix-check.ts did not exit 0" >&2; exit
  1; }
expect: exit 0（无 SKILL.md 的 allowed-tools 使用裸 mcp__quay__ ∧ 静态检查器
  allowed-tools-plugin-prefix-check.ts 存在且退出 0——前半已达成，后半是本条的实质）
origin: |
  人 2026-09-02 裁定②「同一功能，本项目自己使用的扩展应当与产品交付的是同一个；不应有
  『简化版用于产品交付』」。正本 SPEC-plugin-lifecycle-single-bundle-2026-09-02.md AC2。
---

**判据（能取假）**：全部 `plugin/skills/*/SKILL.md` 的 `allowed-tools` 改为 `mcp__plugin_quay_quay__*`
+ 一个静态检查器（SPEC AC2）。

**取假**：当前 `loop-driver`/`routines` 即红——先红后绿。


