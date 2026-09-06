---
id: AC-168
title: quay-init 收缩到 SPEC §6 闭集
status: draft
kind: criterion
goal: GOAL-003
origin: |
  人 2026-09-02 裁定①「quay-init 复制 Claude Code 的各种扩展文件的行为应当废弃，这是非常糟糕的实践」。
  前置 gap-plugin-root-resolution-non-skill-entrypoints——cli/driver.ts:166 从 workspace root 解析
  驱动内核，AC168 停止复制后下游 quay driver start 全线失效；${CLAUDE_PLUGIN_ROOT} 只覆盖 skill 载入
  路径，救不了 CLI/cron/OS anchor。正本 SPEC §6b。
---

**判据（能取假）**：`quay-init` 收缩到 SPEC §6 闭集（只建 quay 项目文件 + 写 Claude Code 侧配置），
**并显式包含安装步骤**（T3：启用 ≠ 安装；未信任目录整份不读项目 settings）。`plugin/test/quay-init*.test.mjs`
随之改写。判据 SPEC AC3——一次**真实 laydown** 的产物清单 ⊆ 闭集（⛔ 不接受 fixture 自证）。


