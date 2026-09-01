---
id: gap-worker-dispatch-prompt-ac-check-instruction
title: worker 派发 prompt 补「逐条验证 AC 并勾选任务体复选框」指令——漏勾 AC 烧整条 fan-in 的根因
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

首轮派发 prompt `buildWorkerPrompt`（`plugin/scripts/worker-driver.ts:920-932`）step (2) 只说「implement the task per its Proposal/Plan/AC/DoD, committing your implementation on the task branch」——**无任何「逐条验证 AC → 任务体勾选 `- [x]`」指令**。唯一强制点是 fan-in 的 `ac-precheck`（`worker-driver.ts:2338-2363`，suite 前 fail-fast，跑 `fan-in-ac-completion-gate.ts --json` 读 worktree 任务体 AC 段 `checked===total`），在 worker 退出之后、且排在锁+merge+anti-drift+typecheck+archguard+scoped-gate+doc-check 全部之后 ⇒ 一次纯漏勾烧掉整条 fan-in + 无超时锁排队 + 1 次 retry。

**证据（来源完备，双载体交叉验证一致）**：最近 3 天 `ac-precheck` 拒翻共 **5 次、5 个不同任务、全部 0/3**（一个复选框都没勾）——`fan-in-<task>-<runId>.log` 的 `step==ac-precheck && ok:false` ⇄ `worker-outcome.jsonl` 的 `mechanical_fan_in.verdict.step==ac-precheck`，两读法计数一致 = 5。全 0/3 ⇒ 不是漏勾一两条，是流程里根本没有「勾 AC」动作。

## Plan

改 `buildWorkerPrompt` step (2)：实现后逐条把已验证满足的 AC 在 worktree 任务体 `## Acceptance Criteria` 勾选 `- [x]`，AC 更新与实现一起提交。一行级改动，打根因。

## Acceptance Criteria

- [ ] AC_A1（机制级，能取假）：派发 prompt 含「勾选任务体 AC 复选框」指令字面（按位置判定，非 grep 注释）；（⛔ prompt 无该指令 ⇒ 假）。

## Definition of Done

`buildWorkerPrompt` 第 2 步补「逐条验证 AC → 任务体勾选 `- [x]` → 与实现一并提交」指令；AC_A1 勾；全量 suite 绿、无回归。

## Touches

- plugin/scripts/worker-driver.ts（buildWorkerPrompt step 2）
- plugin/test/worker-driver.test.mjs（buildWorkerPrompt prompt 断言测试）
- tasks/gap-worker-dispatch-prompt-ac-check-instruction.md（自身）

## Needs-Human

**执行 2026-09-01T07:17:13.409Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
