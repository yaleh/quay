---
id: gap-fan-in-closure-skips-task-end
title: "fan-in closure 跳过 --task-end——landed 任务 telemetry 括号未闭合（SSOT+phase-overlap 两例 start=1 end=0）+ 6 例双 end 过度写"
status: ready
labels:
  - gap
  - defect
  - instrumentation
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`fan-in closure` 未写 `--task-end`：SSOT + phase-overlap 都 LANDED（status done）但 `.workflow-events/` 里只有 `start` 无 `end`（start=1 end=0），使遥测显示「仍在飞」假象（manager 定位 + outer 核实，A20 `reconcile_compliant=false stale_brackets=2`）。另 6 个任务 `start=1 end=2`（双 end 过度写）。telemetry 写路径**双向**都有系统性问题（欠写 end + 过写 end）——「mandatory-write-skipped-adjacent-write-done」又一实例。

## Acceptance Criteria

- [ ] AC1: landed 任务的 `--task-end` 被 closure 正确写入（fan-in 成功后 bracket 闭合）。
- [ ] AC2: 负控制——fan-in land 后 `reconcile_compliant=true`、`stale_brackets=0`（无新 unclosed bracket）。
- [ ] AC3: 双 end 过度写根因定位（为何 end 写两次）。

## Definition of Done

- [ ] 一个 landed 任务的 `--task-end` 真实写入（bracket 闭合，非 fixture）。

## Touches

- tasks/gap-fan-in-closure-skips-task-end.md（自身）
