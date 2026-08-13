---
id: gap-per-test-tail-percentiles-conditional
title: 尾部分位数（条件触发）——per_test_ms 单均值看不见「最后一个测试独占 lane 拖长整相」
status: todo
labels:
  - gap
  - mechanism
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**人指令（2026-08-13）「创建相关任务」；属【性能探索线】，不服务任何阶段 AC ⇒ 排在停全局轮关键路径之后**，
不得挤占 `gap-spec11-retest-2h-nondegradation` 及 AC42/43/45/46 相关任务。A0b⑤(a) 已执行：无重复。

**⚠️ 条件触发，现在不做**：`per_test_ms` 现在只是**单个均值**（实测 `233.814`），看不见「最后一个测试
独占 lane 拖长整相」。**只在 task①/② 显示某相利用率低时才需要**——届时记每测试 start/end 或分位数即可，
**比负载采样便宜得多**（负载采样贵且污染被测对象）。

**本任务 = 占位承接**：条件（某相利用率低）出现时，从 todo 晋升并实现。实现面小（记每测试 start/end
或算分位数），但触发条件未到前不派。

## Plan

1. **等待触发**：task① 的相利用率/相饱和度显示某相利用率低时，本任务晋 ready 实现。
2. 实现：记每测试 start/end 或分位数（p50/p90/p99 + max），识别「最后一个测试独占 lane」。
3. 比负载采样便宜：不引入周期采样。

## Acceptance Criteria

- [ ] AC1 触发条件写死：某相利用率低（task① 直接量）⇒ 本任务可晋。
- [ ] AC2 实现后：每测试分位数（p50/p90/p99/max）可见，能识别「独占 lane 拖长整相」。
- [ ] AC3 不引入负载采样（比采样便宜）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 触发条件出现 → 实现 → 读数可识别尾部独占。
- [ ] 未触发前保持 todo（不派）。

## Touches

- plugin/scripts/full-suite-runner.ts 或 measure 机件（分位数记录，触发后）
- tasks/gap-per-test-tail-percentiles-conditional.md（自身）

## Evidence

（落地后回填）
