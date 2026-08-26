---
id: gap-delivery-status-two-parallel-implementations
title: 「消息投递状态」两条独立实现回答同一问题——serve-send.ts 预测（读权限设置）vs transcript-delivery-check.ts 核证（读 transcript）互不 relate，同名词不同义
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

「消息投递状态」有**两个独立实现**，回答同一问题的不同半面、互不 relate，同名词不同义：

```
① 预测（web 投递入口）：packages/quay/src/serve-send.ts deliveryStateFor(settings)（:117-118）
   按接收方权限设置（permissions.defaultMode=bypassPermissions 或 crossSessionInbound=accept 任一）
   预测 "delivered"/"held"，expired 由预测派生——完全不读 transcript（socket 无 ack，只能预测）
② 核证（fallback 投递路径）：plugin/scripts/transcript-delivery-check.ts
   读 transcript 找物化证据判定 送达/失败/not-materialized——另一条独立实现（人 2026-08-12 裁定的
   fallback tmux/transcript 投递路径的 pure delivery-verdict）
```

**⊢ 同名词不同义**：serve-send.ts 报「delivered」是【预测】（接收方 settings 直通即视为送达）；transcript-delivery-check.ts 报「送达」是【核证】（transcript 有物化证据）。两个「投递状态」概念互不 relate，容易让人以为是同一件事——正是 `gap-web-session-drops-queue-operation-records` 那条附带发现、但独立于渲染缺口。

**⊢ 与 bucket 第二真相源同形**（gap-bucket-second-truth-source-page-recompute）：两个独立实现回答同一问题。修法方向（manager 补）：让 serve-send.ts 的「消息投递」状态**改读 transcript-delivery-check.ts 已有的核证结果**（或共享同一判定源），⛔ 不保留两条平行逻辑各自维护。

**⛔ 边界约束（同 bucket 条）**：`packages/quay/src` 零 `plugin/` 依赖是架构边界——「serve-send.ts 直接 import transcript-delivery-check.ts」被它挡死。共享判定源须走不破边界的路（落盘产物 / 判定函数移到双方可 import 的公共层），实现方自判，⛔ 不得 import plugin/。

## Plan

1. 判定源单一化：serve-send.ts 的「投递状态」改读 transcript-delivery-check.ts 的核证结果，或两者共享同一判定源。
2. 语义统一：「delivered/held/expired」与「送达/失败/未物化」两套词汇要么合并、要么明确定义各自语义并写进文档（⛔ 同名词不同义继续存在 ⇒ 未完成）。

## Acceptance Criteria

- [x] AC1（能取假，单一判定源）：serve-send.ts 的「消息投递」状态改读 transcript-delivery-check.ts 的核证结果（或共享同一判定源），不再各自独立维护预测/核证两套逻辑；（⛔ 仍是两条独立逻辑 ⇒ 假）。
- [x] AC2（能取假，语义统一）：两套「投递状态」词汇语义一致（合并或明确标注各自语义），不再同名词不同义；（⛔ 仍「预测的 delivered」vs「核证的 送达」两义并存 ⇒ 假）。
- [x] AC3（能取假，边界不破）：共享判定源不破坏 packages/quay/src 零 plugin/ 依赖（⛔ import plugin/ ⇒ 假）。

## Definition of Done

投递状态判定源单一化；AC1-AC3 全勾；「delivered」在 web 入口与 fallback 路径语义一致；架构边界不破。

## Touches

- packages/quay/src/serve-send.ts（投递状态改读核证结果/共享判定源）
- packages/quay/test/serve-handlers.test.mjs（移除 settings 预测测试，改为 verdict→state 判定）
- plugin/scripts/transcript-delivery-check.ts（判定源）
- plugin/test/（投递状态单一真相源 + 边界不破测试）
- tasks/gap-delivery-status-two-parallel-implementations.md（自身）
