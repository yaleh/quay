---
id: GOAL-907
title: 完成 src→core 迁移：删 10 个内部 shim，只留 abi.ts 与 config.ts 公开面（shim 12→2）
status: draft
kind: goal
origin: 架构分析改进方案 G-2（2026-10-21 会话，12 个 FORWARDING re-export shim 实测）
---
## 背景

packages/quay/src 根有 12 个「FORWARDING re-export」shim（gap-src-root-gate-cycle-break 迁移的中间态）：abi.ts config.ts branch-model.ts adr-store.ts contract-validator.ts criterion-fidelity.ts plugin-root.ts goal-store.ts frontmatter-store-base.ts document-store.ts worktree-namespace.ts store-commit.ts。实现已下沉 core/，src 根 shim 只作历史导入面。其中 abi.ts（类型视图模型）与 config.ts 是公开 ABI 面，其余 10 个是内部迁移缝。

## 调查结论（机械事实 / 判断分开）

机械事实：12 个 shim 各约 10 行、`export * from "./core/…"`（按位置核对）。消费方（cli/、serve*、provider-client、quay-native）经 src 根路径 import。
判断：公开面（abi/config）保留；内部 shim 删除后消费方改指 core/，可消除图上的双导入面（12 个空壳节点），并让「谁 import 真身」在图上唯一。

## 范围与非目标

范围：删 10 个内部 shim；消费方改指 core/；import-graph-check 加「import 已删 src 根 shim = 违规」棘轮。
非目标：abi.ts / config.ts 保留不动；不碰 core/ 内部实现；不改任何行为。

## AC

- AC-911：src 根 shim 数 12→2（只留 abi.ts 与 config.ts）。