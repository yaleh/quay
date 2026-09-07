---
id: AC-168
title: quay-init 收缩到 SPEC §6 闭集
status: active
kind: criterion
goal: GOAL-003
criterion: >-
  tmp=$(mktemp -d)

  node --experimental-strip-types packages/quay/bin/quay.ts init --root "$tmp"
  >/dev/null 2>&1 || { rm -rf "$tmp"; exit 1; }

  produced=$(cd "$tmp" && find . -type f | sed 's|^\./||' | sort); rm -rf "$tmp"

  allowed=$(sed -n '/QUAY-INIT-CLOSED-SET:BEGIN/,/QUAY-INIT-CLOSED-SET:END/p'
  orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md | sed -n 's/^-
  //p' | sort)

  [ -n "$allowed" ] || exit 1

  f_produced=$(mktemp)

  f_allowed=$(mktemp)

  printf '%s\n' "$produced" > "$f_produced"

  printf '%s\n' "$allowed" > "$f_allowed"

  comm -23 "$f_produced" "$f_allowed" | grep -q .
  && { rm -f "$f_produced" "$f_allowed"; exit 1; }

  rm -f "$f_produced" "$f_allowed"

  exit 0
expect: exit 0（一次真实 quay init --root <repo 外临时目录> 的产物清单 ⊆ SPEC §6 的
  QUAY-INIT-CLOSED-SET 标记块；闭集块缺失即判假，⛔ 不接受 fixture 自证；--root 必须在 repo 外，否则
  quay-init 干净树时会无条件提交而污染 git 历史）
origin: >
  人 2026-09-02 裁定①「quay-init 复制 Claude Code 的各种扩展文件的行为应当废弃，这是非常糟糕的实践」。

  前置 gap-plugin-root-resolution-non-skill-entrypoints——cli/driver.ts:166 从
  workspace root 解析

  驱动内核，AC168 停止复制后下游 quay driver start 全线失效；${CLAUDE_PLUGIN_ROOT} 只覆盖 skill 载入

  路径，救不了 CLI/cron/OS anchor。正本 SPEC §6b。
evidence:
  at: 2026-09-07T01:21:40.901Z
  verdict: fail
  reading: acceptance failed (exit 1)
---

**判据（能取假）**：`quay-init` 收缩到 SPEC §6 闭集（只建 quay 项目文件 + 写 Claude Code 侧配置），
**并显式包含安装步骤**（T3：启用 ≠ 安装；未信任目录整份不读项目 settings）。`plugin/test/quay-init*.test.mjs`
随之改写。判据 SPEC AC3——一次**真实 laydown** 的产物清单 ⊆ 闭集（⛔ 不接受 fixture 自证）。


