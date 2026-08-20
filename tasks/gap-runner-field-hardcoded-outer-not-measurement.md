---
id: gap-runner-field-hardcoded-outer-not-measurement
title: "full-suite-runner 的 runner 字段恒写 \"outer\"（无 --runner 旗标）——结构上不可能取假的量 + AC84 判据1 把它当恒真合取项"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`full-suite-runner.ts:2532` `runner: "outer" as const` 硬编码恒写 `"outer"`（注释自述「无 --runner 旗标」），而 `pre-verified-round-record.ts` 已有 `--runner` 旗标（default `'outer'`）——同一字段两处实现不一致。**硬规则 4**：`runner` 恒 `"outer"` 是结构上不可能取假的量，不是测量（今晚 inner 跑的 100 轮全被标 `runner=outer`）。注释 `:277-283`「runner 只记录名义层身份，不知道调用者是主会话回合 / workflow / subagent」正是承认该字段已失去判别力。

**更关键的连带缺陷**：AC84 判据1 用 `runner=outer && scope=main` 条数=0 判别「outer 主会话直跑」，其中 `runner=outer` 是恒真合取项，实际只有 `scope` 在起判别作用——判据碰巧结论正确，但写成「按执行者归因」的样子而字段没有执行者信息（a8 2026-08-20 发现）。

## Acceptance Criteria

- [ ] AC1: `runner` 字段真实反映执行者——`full-suite-runner.ts` 接 `--runner` 旗标（对齐 `pre-verified-round-record.ts`），**或**给「未评估」第三态（硬规则 3b：无法判定执行者时 `runner=NOT-EVALUATED`，不与 `"outer"` 共用取值）。
- [ ] AC2: 负控制落在生产载体——inner fan-in 的一轮 suite，其 state 记录 `runner` 字段 != `"outer"`（读真实 verification-round / state 记录，非 fixture），**或** AC84 判据1 措辞改为只依赖 `scope`（明确不引用恒真 runner 项）。
- [ ] AC3: scoped 绿 + AC84 判据 / suite-execution-form-counter 不红。

## Definition of Done

- [ ] `runner` 字段不再恒 `"outer"`（真实反映执行者或未评估第三态），AC84 判据1 不再把恒真 `runner` 项当判别依据（真实输出，非 fixture）。

## Touches

- tasks/gap-runner-field-hardcoded-outer-not-measurement.md（自身）
- plugin/scripts/full-suite-runner.ts（runner 字段写真实执行者或未评估第三态，接 --runner 旗标）
- plugin/scripts/pre-verified-round-record.ts（--runner 旗标对齐，若需）
- plugin/test/（runner 字段负控制——非 fixture，读真实 state 记录）
