---
id: gap-verification-round-record-runid
title: appendVerificationRound 记录加 runId 字段——轮记录自描述，可自解析本轮遥测
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`appendVerificationRound`（full-suite-runner.ts:3309）的记录不含 `runId` 字段（红绿都不带）。runId 是「轮记录 ↔ 每轮遥测（suite-load / measure-history）」的连接键：记录无 runId ⇒ /tests 无法按记录自解析负载数据（绿轮 708/709 无 runId ⇒ 无负载曲线的直接原因之一）。加 `runId`（runner 的规范 runId，见 gap-mechanical-fan-in-per-suite-runid-unified）⇒ 每条轮记录自描述。

## Plan

1. `appendVerificationRound` 的 rec 加 `runId` 字段（runner 的规范 runId）。
2. observation.ts 的 TestRunRecord.runId 解析已有（parseVerificationRound 读 runId），确认新字段穿透 /tests 展示。
3. 测试：runner 红绿记录都带 runId；parse 不回归（legacy 无 runId 行容忍）。

## Acceptance Criteria

- [ ] AC1（能取假，读生产载体）：一条 runner 记录（红+绿）带 runId = 该 suite 的规范 runId。（待外部）
- [x] AC2（能取假，负控制）：legacy 无 runId 的记录解析不回归（/tests 仍容忍缺字段）。
- [x] AC3（能取假，单测）：appendVerificationRound 输出形状含 runId，改掉 ⇒ 测试红。

## Definition of Done

verification-round 每条 runner 记录携带本 suite 的 runId；/tests 读取不回归；历史无 runId 行仍可解析。

## Touches

- plugin/scripts/full-suite-runner.ts（appendVerificationRound rec 加 runId）
- packages/quay/src/observation.ts（确认 parse 穿透，无回归）
- plugin/test/full-suite-runner.test.mjs（runId 形状断言）
- packages/quay/test/serve-handlers.test.mjs（/tests 展示 runId 不回归）
- tasks/gap-verification-round-record-runid.md（自身）