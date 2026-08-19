---
id: gap-inflight-states-missing-impl-complete-event
title: "状态机缺「impl-complete」态——补第三个事件，解耦 worktree，Build 派发/落地单飞两个独立计数（删四处推断）"
status: ready
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

状态机（todo→ready→done）**没有能力表达「正在实现」和「实现完成待落地」**。实测 6 个 worktree 对应的任务 status 全 `ready`——正在实现的、实现完等落地的、被 held 的、从未碰过的，七个任务同一个状态。每个消费者只能从旁证推断（worktree 存在 / telemetry / 进程），而每种推断都是代理量（硬规则 4b）。

**已修 5 次推断，缺陷类还在产新实例**（全是同一个缺失状态的症状）：
`gap-slot-refill-inflight-disconnected-from-worktrees`（推断读 0 ⇒ 改读 telemetry）、`gap-worktree-leak-after-fan-in-occupies-slot-permanently`（把已合 worktree 算占用）、`gap-closed-bracket-leaves-live-agent-consuming-slots`（括号关了进程还活）、`gap-slot-free-not-an-event-slots-stay-empty-missed`（空槽不是事件）、`gap-reconcile-step-skipped-no-compliance-product`（reconcile 跳过无产物）。第 21 条（加 pgrep 判活）是第 6 个补丁，已被 superseded。

**正确修法（人裁定：解耦 + 简化，把状态记下来，不推断）**：`.workflow-events/fm-*.jsonl` 每任务已是 append-only 事件流，但只有 start/end 两个事件、跨越 impl+land 一整段——**「impl 完成」这个时刻在系统里根本不存在**。

## Acceptance Criteria

- [x] AC1: 补第三个事件 `impl-complete`（awaiting-land）——fan-in-execute 在 impl 完成后、land 前写该事件，把「start→end 一整段」拆成「start→impl-complete（实现）」「impl-complete→end（待落地）」两段。
- [x] AC2: 两个独立计数——Build 派发闸数「有 start 无 impl-complete」（= 真正在实现）；落地单飞闸数「有 impl-complete 无 end」（= 排队待落地），各自独立、独立上限。
- [x] AC3: worktree 退回纯实现细节（代码放哪儿），任何并发记账都不再读它。
- [x] AC4: 删四处推断（删代码非加代码）——`slot-refill` 的 `--slot-status` 推导、`--reconcile` 的 `keepReason: worktree-present` 推断、面板 `pairInFlight` 的「start 无 end ⇒ in-flight」、第 21 条要加的 pgrep。
- [x] AC5: 负控制落在生产载体——一个「实现完待落地」的任务，Build 派发不数它、落地单飞数它（读真实事件流，非 fixture）；「正在实现」的任务反之。

## Definition of Done

- [x] 「正在实现」和「实现完待落地」在事件流里可区分，Build 派发/落地单飞各读各自的数、不再读 worktree，四处推断删除（真实输出）。

## Touches

- tasks/gap-inflight-states-missing-impl-complete-event.md（自身）
- plugin/scripts/workflow-event-schema.mjs（impl-complete 事件 schema）
- plugin/workflows/fan-in-execute.js（impl 完成后写 impl-complete；双拷贝同步 .claude/workflows/fan-in-execute.js）
- plugin/scripts/slot-refill.ts（Build 派发数「有 start 无 impl-complete」，删 --slot-status 推导）
- plugin/scripts/fast-mode-telemetry.ts（--reconcile 删 keepReason: worktree-present 推断）
- packages/quay/src/observation.ts（pairInFlight 读 impl-complete 两段）
- packages/quay/src/serve-handlers.ts（board 执行列渲染「实现中/待落地」两段独立计数；impl 续做补录）
- plugin/test/slot-refill.test.mjs（Build 派发「有 start 无 impl-complete」负控制）
- plugin/test/fast-mode-telemetry.test.mjs（--reconcile 删 keepReason 推断负控制）
- plugin/test/fan-in-execute-paths.test.mjs（impl-complete 事件负控制）
- packages/quay/test/serve-board.test.mjs（pairInFlight 两段计数负控制）
