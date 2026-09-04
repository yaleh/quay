---
id: gap-mechanical-fan-in-per-suite-runid-unified
title: 机械 fan-in 的 per-suite runId 统一贯穿——runner 接受 --run-id，state/load/记录三者同键
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

机械 fan-in 路径的 suite 运行没有单一规范 runId：runner 用自身 `randomUUID()`（full-suite-state / suite-load 文件名键 / generation guard），红轮记录被 `writeRedSuiteRecord` 注入 driver 的共享 wk-prod runId，绿轮记录无 runId。runId 是「轮记录 ↔ 每轮遥测」的连接键，键断 ⇒ /tests 按 record.runId 查不到 suite-load-<runId>.jsonl ⇒ #692 起无负载数据（实证：红 692 记录 runId=wk-prod-1788022868，而 .quay 下 218 个 suite-load 文件键全是 runner UUID / fm-*，无 wk-prod 键）。

已工作的 fan-in-execute 路径（fm-<task>-<ts>-<suffix>）把 runId 统一进记录 + load 文件名，故 fm-* 轮有负载数据。本任务让机械路径对齐它。

设计：driver 机械路径为每次 fan-in 生成唯一 per-suite runId `mfi-<task>-<epoch>-<suffix>`（⛔ 不用共享的 wk-prod——那是 driver 轮次号，一 driver 轮次内多个 suite 共用，不能当 suite 身份），传给 runner；runner 接受 `--run-id`，用它替代 `randomUUID()`，贯穿 full-suite-state / generation guard / load sampler 键 / 记录。

## Plan

1. runner（full-suite-runner.ts:1781）接受 `--run-id`：`const runId = parseArg(argv, "--run-id") ?? randomUUID()`；shortRunId / leak 命名空间从其派生（保持 8-hex 截断约束）。
2. worker-driver.ts `defaultMechanicalSuiteCommand` 传 `--run-id <per-suite>`；`runMechanicalFanIn` 生成 per-suite runId（`mfi-<task>-<epoch>-<rand>`），每次 fan-in 唯一。
3. suite-driver.ts 的 `writeRedSuiteRecord`（若 gap-verification-round-single-writer 未先删）与 runner 记录使用同一 per-suite runId（不再用 wk-prod）。
4. 测试：runId 传进 runner 且 full-suite-state / suite-load-<runId>.jsonl / 记录三者一致；缺省无 --run-id 时仍 randomUUID（独立运行不回归）。

## Acceptance Criteria

- [ ] AC1（能取假，读生产载体）：一条机械 fan-in 落地后，full-suite-state 的 runId、suite-load-<runId>.jsonl 文件名、verification-round 记录 runId 三者一致（不再 wk-prod 混入记录）。（待外部）
- [x] AC2（能取假，唯一性）：同一 driver 轮次内两个不同任务的 per-suite runId 不同（一次 fan-in 一个 id）。
- [x] AC3（能取假，单元）：runner 传 --run-id 用该值、缺省回退 randomUUID；shortRunId 仍满足 tmux socket 长度约束。

## Definition of Done

一次真实机械 fan-in 后，其 verification-round 记录的 runId 与同名 suite-load 文件实际存在，/tests 该轮负载曲线出现（非 fixture、读生产载体）。

## Touches

- plugin/scripts/full-suite-runner.ts（接受 --run-id）
- plugin/scripts/worker-driver.ts（per-suite runId 生成 + defaultMechanicalSuiteCommand 传参）
- plugin/scripts/suite-driver.ts（writeRedSuiteRecord 已被 gap-verification-round-single-writer 删——本任务无改动）
- plugin/test/full-suite-runner.test.mjs（--run-id 缺省/覆盖）
- plugin/test/worker-driver.test.mjs（per-suite 唯一性）
- tasks/gap-mechanical-fan-in-per-suite-runid-unified.md（自身）