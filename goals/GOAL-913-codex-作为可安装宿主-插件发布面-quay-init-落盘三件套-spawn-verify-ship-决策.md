---
id: GOAL-913
title: Codex 作为可安装宿主——插件发布面 + quay init 落盘三件套 + spawn-verify ship 决策
status: achieved
kind: goal
origin: 人 2026-10-30 裁定：GOAL-912 成果对发布链零 ship（.codex/config.toml
  宿主硬编码、.agents/skills 与 AGENTS.md 不 ship、无 .codex-plugin 面、spawn-verify 被
  prune），本 goal 补全
activatedAt: 2026-10-30T05:32:13.334Z
statusLog:
  - at: 2026-10-30T05:32:13.334Z
    from: draft
    to: active
    actor: goal-cli
    reason: 人 2026-10-30 裁定激活：Codex 可安装宿主补全
  - at: 2026-10-30T07:49:15.729Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
---
## 退出条件

一个 Codex 用户能从 marketplace 安装 quay 插件、在其项目中 `quay init` 即得 Codex 三件套（.codex/config.toml 项目相对 cwd + .agents/skills/ + AGENTS.md）、用 Codex 操作 quay 任务；spawn-verify/selfcheck 的 ship 决策已由人裁定并成文，且 shipped 产物与决策一致（ship 则 reachable，dev-tree-only 则无用户面宣传）。

## 范围与非目标

范围：Codex 插件发布面（.codex-plugin/plugin.json，args 指向安装后 dist 非 dev-tree source）、quay init 落盘三件套（CLOSED_SET_ITEMS 扩展 + config cwd 项目相对）、spawn-verify ship 决策成文+一致性判据。非目标：driver 派发 / codex exec 短会话（GOAL-912 同）、Codex 技能内容重写、Host Adapter。

## 决策点（执行中由人裁定）

spawn-verify/selfcheck 是否 ship：ship（则 shipped-shell-reachability 标记 reachable + capability-catalog 无矛盾）或 dev-tree-only（则成文记录边界 + 用户面无宣传）。裁定后落地为 AC-933 的一致性判据。