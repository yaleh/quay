---
id: gap-suite-round-pass-fail-cancel-fields
title: suite 轮记录补 pass/fail/cancelled 三字段（数据模型缺口，⛔ 非前端）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager web 巡检投立案（代码级核实）。

**证据（⛔ 不是渲染 bug，是数据模型缺口）**：`serve-handlers.ts:2297` 正确写了 `r.pass ?? "—"`，但载体 `.quay/verification-round.jsonl` schema **根本没有 `pass`/`fail`/`cancelled` 字段**——逐轮打印 key 集合只有 `state`(green/red)、`durationMs`、`buckets`、`scope` 等，无任何测试计数；`grep -rn "'pass'|passCount|tests_passed" full-suite-runner.ts measure-suite-reporter.mjs` 零命中——**全链路没有任何写手产出过这三个数**。

**调查深度（如实标注，⛔ 别低估）**：需先让 runner/reporter 在轮记录新增三字段，是运行时载体 schema 变更，非纯前端修补。

## Plan

1. fan-in 轮记录 writer（`plugin/scripts/pre-verified-round-record.ts`——生产落地路径的实际 writer，非 full-suite-runner.ts）从 `--suite-log` 解析 node:test spec-reporter 汇总（`ℹ pass/fail/cancelled`，跨 serial→lowconc→main 三相块求和），在轮记录写 `pass`/`fail`/`cancelled`/`tests` 字段。
2. web 消费面（serve-handlers.ts:2297 的 `r.pass ?? "—"`）已写就，数据接上即显真实计数。

## Acceptance Criteria

- [x] AC1：`.quay/verification-round.jsonl` 每轮记录含 `pass`/`fail`/`cancelled` 三字段（读生产载体，⛔ 非 fixture）。
- [x] AC2：Tests 页 + Dashboard 卡片显示真实测试计数（⛔ 恒 "—/—/—" ⇒ 假）。

## Definition of Done

- [x] runner 写三字段 + web 显示真实计数；AC1-2 全勾；land 到 develop。

## Retires

- 无（新增字段）

## Touches

- plugin/scripts/pre-verified-round-record.ts（fan-in 轮记录写三字段——生产落地路径的实际 writer，非 full-suite-runner.ts）
- plugin/test/pre-verified-round-record.test.mjs（pin 新字段行为）
- tasks/gap-suite-round-pass-fail-cancel-fields.md（自身）
