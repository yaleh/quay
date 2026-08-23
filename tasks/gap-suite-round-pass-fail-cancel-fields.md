---
id: gap-suite-round-pass-fail-cancel-fields
title: suite 轮记录补 pass/fail/cancelled 三字段（数据模型缺口，⛔ 非前端）
status: ready
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

1. runner/reporter（full-suite-runner.ts / measure-suite-reporter.mjs）在轮记录写 `pass`/`fail`/`cancelled` 三字段。
2. web 消费面（serve-handlers.ts:2297 的 `r.pass ?? "—"`）随之显示真实计数。

## Acceptance Criteria

- [ ] AC1：`.quay/verification-round.jsonl` 每轮记录含 `pass`/`fail`/`cancelled` 三字段（读生产载体，⛔ 非 fixture）。
- [ ] AC2：Tests 页 + Dashboard 卡片显示真实测试计数（⛔ 恒 "—/—/—" ⇒ 假）。

## Definition of Done

- [ ] runner 写三字段 + web 显示真实计数；AC1-2 全勾；land 到 develop。

## Retires

- 无（新增字段）

## Touches

- plugin/scripts/full-suite-runner.ts（轮记录写三字段）
- plugin/scripts/measure-suite-reporter.mjs（如涉 reporter）
- packages/quay/src/serve-handlers.ts（消费面已写 `r.pass ?? "—"`，数据接上即显）
- plugin/test/full-suite-runner.test.mjs（三字段测试）
- plugin/test/measure-suite-reporter.test.mjs（如涉）
- packages/quay/test/serve-handlers.test.mjs（计数渲染测试）
- tasks/gap-suite-round-pass-fail-cancel-fields.md（自身）
