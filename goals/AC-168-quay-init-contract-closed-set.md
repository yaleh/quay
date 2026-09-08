---
id: AC-168
title: quay-init 收缩到 SPEC §6 闭集
status: active
kind: criterion
goal: GOAL-003
criterion: grep -qE '^[[:space:]]*copy_dir
  "\$PLUGIN_ROOT/(scripts|agents|workflows)"|^[[:space:]]*copy_one
  "\$PLUGIN_ROOT/scripts/\$s"' plugin/scripts/quay-init.sh && exit 1; exit 0
expect: exit 0（plugin/scripts/quay-init.sh 中不再存在把
  $PLUGIN_ROOT/scripts|agents|workflows 整体或逐脚本 copy 进目标工作区的调用点——静态判据，非 fixture
  自证；旧判据改跑 quay init（CLI, DIR-098）而非 /quay:init 技能实际调用的 quay-init.sh，quay init
  从未做过复制、判据结构上不可能取假，已由 2026-09-08 复核撤销）
origin: >
  人 2026-09-02 裁定①「quay-init 复制 Claude Code 的各种扩展文件的行为应当废弃，这是非常糟糕的实践」。

  前置 gap-plugin-root-resolution-non-skill-entrypoints——cli/driver.ts:166 从
  workspace root 解析

  驱动内核，AC168 停止复制后下游 quay driver start 全线失效；${CLAUDE_PLUGIN_ROOT} 只覆盖 skill 载入

  路径，救不了 CLI/cron/OS anchor。正本 SPEC §6b。
---

**判据（能取假）**：`quay-init` 收缩到 SPEC §6 闭集（只建 quay 项目文件 + 写 Claude Code 侧配置），
**并显式包含安装步骤**（T3：启用 ≠ 安装；未信任目录整份不读项目 settings）。`plugin/test/quay-init*.test.mjs`
随之改写。判据 SPEC AC3——一次**真实 laydown** 的产物清单 ⊆ 闭集（⛔ 不接受 fixture 自证）。


