---
id: AC-168
title: quay-init 收缩到 SPEC §6 闭集
status: achieved
kind: criterion
goal: GOAL-003
criterion: "grep -qE '^[[:space:]]*copy_dir
  \"\\$PLUGIN_ROOT/(scripts|agents|workflows)\"|^[[:space:]]*copy_one
  \"\\$PLUGIN_ROOT/scripts/\\$s\"' plugin/scripts/quay-init.sh && { echo
  \"AC-168 fail: plugin/scripts/quay-init.sh still copies
  \\$PLUGIN_ROOT/scripts|agents|workflows into the target workspace\" >&2; exit
  1; }; exit 0"
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

**⊕ 2026-09-08 复核更正（发现：本 AC 判据曾测错对象，硬规则4/3b 同形）**：原判据跑
`node packages/quay/bin/quay.ts init --root <tmp>`——这是 DIR-098 的 CLI `quay init`，它自始
只建空任务库（`.quay/config.yml`+`tasks/`），**从未复制过任何扩展文件**；真正会复制
111-131 个机制脚本的是 `/quay:init` 技能实际调用的 `plugin/scripts/quay-init.sh`
（`plugin/skills/init/SKILL.md:14`「copy logic lives in ONE executable」）。原判据结构上
不可能取假，恒 pass，`achieved` 是假阳性。已改为对 `quay-init.sh` 本体的静态判据（检查
`copy_dir "$PLUGIN_ROOT/{scripts,agents,workflows}"` / `copy_one "$PLUGIN_ROOT/scripts/$s"`
调用点是否仍存在）——选静态而非跑一次真实 `--loop` laydown，是因为 goal-driver 该 goal 的
`interval_ms=30000`，一次真实 `--loop` 铺设约 400 次子进程 spawn，不适合塞进 30s 轮询；
真正的「真实 laydown ⊆ 闭集」断言留给收缩本体任务自建的专用判据（非 30s 轮询对象）。
`status` 由 `achieved` 改回 `active`，`gate` 实测已确认新判据 `verdict:"fail"`（真实反映
`quay-init.sh` 尚未收缩）。真正达成路径：`gap-plugin-root-resolution-remaining-callsites`
（承重前提）→ `gap-quay-init-closure-shrink-body`（收缩本体，落地后本判据应转 pass）。
