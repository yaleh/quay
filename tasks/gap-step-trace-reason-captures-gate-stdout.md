---
id: gap-step-trace-reason-captures-gate-stdout
title: step-trace reason 捕获 gate 完整 stdout——现只留 MODULE_TYPELESS 警告行，真判词没进载体
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

fan-in step-trace 的 reason 现只留 Node `MODULE_TYPELESS_PACKAGE_JSON` 警告行（stderr 噪声），真判词（ac-gate 的 checked 数 / anti-drift 的 violation）没进载体。实证 `.quay/fan-in-gap-*-wk-prod-*.log` 中 ac-gate/anti-drift 失败 reason 均为该警告。与 `gap-scoped-gate-reason-stderr-drops-stdout`（done）同族，但这是 step-trace 载体（不是 fail() 的 reason 构造）。

## Plan

step-trace 的 reason 捕获 gate 完整 stdout（非 stderr 警告优先）——失败步的 reason 记录 stdout 的判词（如 ac-gate 的 checked X/Y、anti-drift 的 violation 列表）。

## Acceptance Criteria

- [x] AC1（能取假）：ac-gate/anti-drift 失败时 step-trace reason 含 stdout 判词（grep 到 checked/violation）非纯 MODULE 警告；（⛔ 仍只有警告 ⇒ 假）。
- [x] AC2（能取假，单测）：worker-driver.test.mjs 断言「失败步 reason 含 stdout 判词」，改掉任一 ⇒ 红。

## Definition of Done

step-trace reason 捕获 gate stdout；AC1-AC2 全勾；全量 suite 绿。

## Touches

- plugin/scripts/worker-driver.ts（step-trace reason 捕获 stdout）
- plugin/test/worker-driver.test.mjs（AC2 单测）
- tasks/gap-step-trace-reason-captures-gate-stdout.md（自身）
