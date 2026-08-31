---
id: gap-execution-loop-p4-suite-entry-ts-ization
title: P4 残余①——scripts/test.sh suite 入口 TS 化收尾（决策逻辑抽 TS 纯函数）
status: ready
labels:
  - gap
  - productization
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

从 `gap-execution-loop-productization-p2-p4`（拆条，P2 收窄落地）拆出的 P4 残余①：`scripts/test.sh` 收窄为薄转发或并入 `full-suite-runner.ts`——决策逻辑（main_root 推导、default_concurrency_formula、serial_lowconc_host_default、has_explicit_concurrency、arg→mode 分发）抽 TS 纯函数带单测。

## Plan

1. `scripts/test.sh` 的决策逻辑抽到 TS 纯函数（`runner-concurrency.ts` 已起步），test.sh 收窄为薄转发。
2. 全量 suite 不回归。

## Acceptance Criteria

- [x] AC1（能取假，suite 入口 TS 化）：`scripts/test.sh` 决策逻辑抽 TS 纯函数带单测，test.sh 收窄为薄转发或并入 full-suite-runner.ts，全量 suite 不回归；（⛔ test.sh 仍持决策逻辑 / suite 回归 ⇒ 假）。

## Definition of Done

test.sh 决策逻辑抽 TS 纯函数带单测、test.sh 收窄为薄转发或并入 full-suite-runner.ts；AC1 全勾；全量 suite 绿（不回归）。

## Touches

- scripts/test.sh（收窄为薄转发）
- plugin/scripts/runner-concurrency.ts（决策逻辑纯函数）
- plugin/test/resource-gate.test.mjs（决策逻辑跨实现对照单测）
- plugin/test/runner-concurrency.test.mjs（纯函数单测）
- tasks/gap-execution-loop-p4-suite-entry-ts-ization.md（自身）

## Needs-Human

**执行 2026-08-31T12:41:27.308Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
