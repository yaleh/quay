---
id: gap-bucket-scoped-worktree-skips-perfile-reporter
title: bucket-scoped worktree 执行路径不触发 per-file reporter（perFile/ceiling/floor_ms 生产 0 命中）
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

**来源**：manager wiring 审计（webui/test-detail 群组，gap-test-detail-perfile-duration-failed 的 AC1 生产验证失败）。

**现象（实测，⛔ 非推断）**：`gap-test-detail-perfile-duration-failed` 实现落地（`7affdd43`, 06:57:20Z）后，`.quay/verification-round.jsonl` 全部 **15 条真实生产 round，`perFile` 字段命中数=0**。**非本任务引入回归**：同一 reporter 的姊妹字段 `ceiling`/`floor_ms`（更早上线、理应已验证）在这 15 条里**同样 0 命中** ⇒ 当前生产实际走的「bucket-scoped worktree」执行路径本身就不触发 per-file reporter 输出流入 round 记录——环境性/更早就存在的缺口，本任务只是撞上同一个洞。

**影响**：`perFile`/`ceiling`/`floor_ms` 等 per-file 字段生产全空，任何读这些字段的判据/展示都拿不到数据（不只是 test-detail 这条，是全套 per-file 指标的共同载体）。

## Plan

1. 定位 bucket-scoped worktree 执行路径为什么不调用 per-file reporter（大概率 `full-suite-runner.ts` 某 scope 分支跳过了逐文件输出收集）。

## Acceptance Criteria

- [ ] AC1：定位 bucket-scoped 路径跳过 per-file reporter 的 scope 分支，并修（或确认设计如此并文档化）；生产 round 记录里 `perFile`/`ceiling`/`floor_ms` 命中数不再恒 0。

## Definition of Done

- [ ] bucket-scoped 路径 per-file reporter 缺口定位 + 修 + 生产 round 出现 per-file 字段；AC1 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/full-suite-runner.ts（per-file reporter scope 分支）
- plugin/test/full-suite-runner.test.mjs（test）
- tasks/gap-bucket-scoped-worktree-skips-perfile-reporter.md（自身）
