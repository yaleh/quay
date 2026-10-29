---
id: GOAL-912
title: Codex 作为 quay 的长期支持宿主——交互式 operator 阶段，driver 会话链路除外
status: active
kind: goal
origin: 人 2026-10-29 裁定「长期支持」+ goal branch 模式（SPEC-codex-long-term-support
  §1）；证据=本会话 cwd 实测与 DIR-121 无理由 superseded 核查
activatedAt: 2026-10-29T07:34:40.077Z
statusLog:
  - at: 2026-10-29T07:34:40.078Z
    from: draft
    to: active
    actor: goal-cli
    reason: 人 2026-10-29 裁定：长期支持 + goal branch 模式（SPEC-codex-long-term-support §1 ③）
branch: true
---
## 退出条件

一个 fresh Codex 会话在任意工作根下都能连上 quay MCP、在显式人授权下完成真实 task 编辑/创建并留下可机检证据、宿主侧载体单源无漂移、且 Codex 侧未获得任何超出 operator 契约的生命周期权限——这些保证由 goal-driver 每轮复验（AC-927/928/930 为 long-term），不随 task 翻 done 失效。

## 范围与非目标

范围：交互式 operator 阶段（宿主侧 MCP/Skill 载体 + 长期维持）。非目标：Host Adapter（control plane）、resident（CloudCLI）、driver 派发/`codex exec` 短会话、Provider ABI 承载 execution、DIR-121 复活（HARD terminal）。