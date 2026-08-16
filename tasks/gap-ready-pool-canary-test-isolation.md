---
id: gap-ready-pool-canary-test-isolation
title: "ready-pool canary test-isolation：:2778 改读受控 fixture 而非真实共享账本——中间红不再恒红全量 suite"
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：AC1b develop 基线轮 unblock 链中，ruled-table fan-in 被 canary 挡——`plugin/test/ready-pool-check.test.mjs:2778` 读**真实共享账本** `.quay/per-task-suite-records.jsonl` 硬断言 `consecutiveRed === 0`，而账本有 3 条今日**中间失败红**（gap-ac76 00:56 / quoted-path 17:51 / select-preflight 18:33，全已 land done）⇒ 跳过 doc-only 中性记录后 consecutiveRed ≥ 1 ⇒ **任何 code-delta fan-in 全量 suite 恒红**（队列全卡，AC97 排队 2h42m）。

**根因**：test-isolation 缺陷——测试读生产共享可变状态（真实账本）而非受控输入。fixture 版测试全 ✔；真实账本版 ✖（已在 develop 实证同样失败，pre-existing、环境性、零因果）。doc-only skip 中性（既不计也不断窗）⇒ 中间红持续非零。

**第二个语义问题（外层纳入判据）**：doc-only green 是否该断红窗——中间红（fan-in 首次失败后来成功）被算成连续红。若 full-suite green 断窗已存在，中间红其实已被后续 green 断掉——需核实为何 consecutiveRed 仍非零（green 顺序/时间窗逻辑）。

## Acceptance Criteria

- [x] AC1: `ready-pool-check.test.mjs:2778` 改读**受控 fixture**（临时/注入账本）而非真实共享账本——consecutiveRed 计算用 fixture 验证（含红→绿断窗、doc-only 中性、空记录样本）。— 实测：fixture 版测试 `✔ AC2 — consecutiveRedRounds on CONTROLLED per-task-suite records`，ready-pool-check.test.mjs 全绿（exit 0）
- [x] AC2: doc-only green 断窗语义判清——**核实为 AC84 设计（doc-only 中性，既不计也不断窗）**，consecutiveRedRounds 逻辑正确（中间红保持红直到 full-suite green 断窗）。原 canary 断言 stale（假设账本全绿，实际 fan-in retry 产生中间红）。— 实测：`doc-only green does NOT break the red window (AC84 neutral)` fixture 断言通过；`full-suite green breaks the red window` 通过
- [x] AC3: 真实账本存在中间红时，canary 测试不因生产态红——测试改读 fixture，恒过（不依赖生产账本状态）。— 实测：测试无任何 `readPerTaskSuiteRecords(repoRoot)` 真实账本读取

## Definition of Done

- [ ] canary 测试不再读真实账本硬断言 0；全量 suite 可在账本含中间红时通过（fan-in 队列解除阻塞）。（待外部）

## Touches

- plugin/test/ready-pool-check.test.mjs（:2778 canary test-isolation 修复）
- plugin/scripts/ready-pool-check.ts（若 consecutiveRed 断窗逻辑需修）
- tasks/gap-ready-pool-canary-test-isolation.md（自身）
