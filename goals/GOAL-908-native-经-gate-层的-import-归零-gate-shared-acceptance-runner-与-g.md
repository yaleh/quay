---
id: GOAL-908
title: native 经 gate/ 层的 import 归零：gate/shared/acceptance-runner 与
  gate/gate-event-store 改指 core 真身或 exports，棘轮「provider→gate/」违规
status: active
kind: goal
origin: 架构分析改进方案 G-3（2026-10-21 会话，native 经 gate 层 2 条转发 shim import）
activatedAt: 2026-10-21T08:17:51.119Z
statusLog:
  - at: 2026-10-21T08:17:51.119Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
---
## 背景

GOAL-907（已 achieved）把 packages/quay/src 根的 12 个转发 shim 删到 2（abi.ts + config.ts）。native 的 import 随之从「src 根 shim」改指「core 真身」，但仍有 2 条经 gate/ 层的转发 shim：`mcp-server.ts:26` 的 `gate/shared/acceptance-runner.ts` 与 `mcp-server.ts:32` 的 `gate/gate-event-store.ts`。这两个 gate/ 侧文件是 `export * from "../../core/…"` 的转发 shim（gap-src-root-gate-cycle-break 遗留），native 作为 provider 经 gate/ 层路径 import，绕过了「provider 只依赖 ABI 表面（abi.ts + kernel 共享叶 + package exports）」的分层意图。

## 调查结论（机械事实 / 判断分开）

机械事实（scope b4f87b21 @ d4ed6e37f，2026-10-21 实测）：native → Core 的 relative import 共 15 条——core/goal-store ×3、abi ×2、kernel ×4（task-transition/task-shape-artifacts/shape-sections/gate-run-options）、task-parsing/search-index/meta-store/goal-ac-write-face/core/store-commit 各 1、**gate/shared/acceptance-runner + gate/gate-event-store 各 1**。gate 侧两文件是转发 shim（gate/shared/acceptance-runner.ts:1 头注释 "FORWARDING re-export … implementation moved DOWN to core/"）。

判断：kernel/* 是设计上的共享叶（允许双向到达）、abi.ts 是公开 ABI 面，都合法；但 gate/ 层路径不是 native 该 import 的——真身在 core/，native 应改指 core/acceptance-runner.ts 与 core/gate-event-store.ts，或经 package.json exports 暴露。

## 范围与非目标

范围：native 的 gate/ 层 import 2→0（改指 core 真身或 exports）；import-graph-check 加「provider → quay/src/gate/ 边 = 违规」棘轮。
非目标：不碰 native 的 kernel/* 与 abi.ts import（合法）；不碰 core/ 内部实现；不改 native 的运行时依赖声明（quay:* 保留）。

## AC

- AC-913：native 经 gate/ 层的 import 归零（gate/shared/acceptance-runner + gate/gate-event-store 改指 core 真身或 exports）。