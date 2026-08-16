---
id: gap-ready-pool-canary-test-isolation
title: "ready-pool-check.test.mjs:2778 读真实共享账本恒红——canary 死锁，block 整个 fan-in 队列（test-isolation）"
status: ready
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

**来源**：inner 2026-08-16 19:5xZ 上报 + outer 核实。

**canary 死锁**：`ready-pool-check.test.mjs:2778` 读**真实共享账本**（`.quay/per-task-suite-records.jsonl`）硬断言
`consecutiveRed === 0`，而账本有 3 条中间失败红（gap-ac76 / quoted-path 17:51 / select-preflight 18:33，
**全已 land done**）⇒ 跳过 doc-only green 后 consecutiveRed 非零 ⇒ **任何 code-delta fan-in 全量 suite 恒红**。
已实证 develop 上同测试也失败（pre-existing，环境性，零因果）。**这阻塞整个 fan-in 队列**（AC97 排队 2h42m 的根因链一环）。

**根因**：测试**读真实共享账本**而非受控 fixture——账本内容随环境演化，测试断言却硬编码「all-green ⇒ consecutiveRed 0」，
账本一旦有中间红即恒红。fixture 版测试全 ✔（同文件 :2408 附近的 window-detection 测试），真实账本版 ✖。

**⊢ 连带语义问题（inner 提，一并判）**：consecutiveRed 跳过 doc-only green 的逻辑本身可疑——中间红
（fan-in 首次失败后来成功）被算成连续红。doc-only skip 是 NEUTRAL（:1114-1120 确认：既不计也不断窗）。
**「成功落地后是否该断窗」是语义问题**，值得判据明确——若 full-suite green 已断窗，为何 consecutiveRed
仍非零（可能是 green 顺序/时间窗逻辑）。**实现方在任务里一并判清。**

## Acceptance Criteria

- [ ] AC1: `ready-pool-check.test.mjs:2778` 改读**受控 fixture**（临时/注入账本）而非真实共享账本，
      断言逻辑（consecutiveRed 计算）用 fixture 验证。真实账本演化不再使测试恒红。
- [ ] AC2: consecutiveRed 断窗语义判清并落测试：中间红（fan-in 首次失败后来 full-suite green）是否算连续红——
      按判清后的语义，构造 fixture 样本断言。⛔ 不因「判不清」而维持现状。
- [ ] AC3: 修复随 fan-in 可 land（worktree 含修复测试 ⇒ suite 跑固定版 ⇒ 过 ⇒ land，不自我阻塞），
      且 develop 上同测试转绿。

## Definition of Done

- [ ] canary 死锁解除——任何 code-delta fan-in 全量 suite 不再因此测试恒红；consecutiveRed 断窗语义明确。

## Touches

- plugin/test/ready-pool-check.test.mjs（:2778 test-isolation + 断窗语义测试）
- plugin/scripts/ready-pool-check.ts（若断窗语义判明需改——inner 判）
- tasks/gap-ready-pool-canary-test-isolation.md（自身）
