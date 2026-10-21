---
id: GOAL-908
title: native 经 gate/ 层的 import 归零：gate/shared/acceptance-runner 与
  gate/gate-event-store 改指 core 真身或 exports（provider→gate/ 棘轮为防回归手段）
status: achieved
kind: goal
origin: 架构分析改进方案 G-3（2026-10-21 会话，native 经 gate 层 2 条转发 shim import）
activatedAt: 2026-10-21T08:17:51.119Z
statusLog:
  - at: 2026-10-21T08:17:51.119Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-21T14:54:50.917Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
---
## 背景

GOAL-907（已 achieved）把 packages/quay/src 根的 12 个转发 shim 删到 2（abi.ts + config.ts）。native 的 import 随之从「src 根 shim」改指「core 真身」，但仍有 2 条经 gate/ 层的转发 shim：`mcp-server.ts:26` 的 `gate/shared/acceptance-runner.ts` 与 `mcp-server.ts:32` 的 `gate/gate-event-store.ts`。这两个 gate/ 侧文件是 `export * from "../../core/…"` 的转发 shim（gap-src-root-gate-cycle-break 遗留），native 作为 provider 经 gate/ 层路径 import，绕过了「provider 只依赖 ABI 表面（abi.ts + kernel 共享叶 + package exports）」的分层意图。

## 调查结论（机械事实 / 判断分开）

机械事实（scope b4f87b21 @ d4ed6e37f，2026-10-21 实测）：native → Core 的 relative import 共 15 条——core/goal-store ×3、abi ×2、kernel ×4（task-transition/task-shape-artifacts/shape-sections/gate-run-options）、task-parsing/search-index/meta-store/goal-ac-write-face/core/store-commit 各 1、**gate/shared/acceptance-runner + gate/gate-event-store 各 1**。gate 侧两文件是转发 shim（gate/shared/acceptance-runner.ts:1 头注释 "FORWARDING re-export … implementation moved DOWN to core/"）。

判断：kernel/* 是设计上的共享叶（允许双向到达）、abi.ts 是公开 ABI 面，都合法；但 gate/ 层路径不是 native 该 import 的——真身在 core/，native 应改指 core/acceptance-runner.ts 与 core/gate-event-store.ts，或经 package.json exports 暴露。

## 范围与非目标

范围：native 的 gate/ 层 import 2→0（改指 core 真身或 exports）；import-graph-check 加「provider → quay/src/gate/ 边 = 违规」棘轮（手段 / 防回归，不是独立退出条件——退出条件只写终态，棘轮由执行任务 `gap-ac913-native-gate-layer-imports-zero` 的 AC3 交付）。
非目标：不碰 native 的 kernel/* 与 abi.ts import（合法）；不碰 core/ 内部实现；不改 native 的运行时依赖声明（quay:* 保留）。

## 退出条件

① `packages/quay-native/src/` 下对 `quay/src/gate/` 的 import 计数为 0（AC-913 criterion 逐字读绿，stdout 为 `OK: native imports 0 gate-layer paths`）；
② 原本经 gate/ 层的两条 import 已改指 core 真身或经 package exports：`../../quay/src/core/acceptance-runner.ts` 与 `../../quay/src/core/gate-event-store.ts` 在 `packages/quay-native/src/mcp-server.ts` 中各出现 1 次；
③ 判据能取假：故意保留一条 gate/ 层 import ⇒ grep 计数 1、stderr 写 cause、exit 1；移除 ⇒ 计数 0、exit 0；
④ AC-913 achieved（①–③ 全部由 AC-913 的 criterion 与 expect 覆盖）。

## AC

- AC-913：native 经 gate/ 层的 import 归零（gate/shared/acceptance-runner + gate/gate-event-store 改指 core 真身或 exports）。