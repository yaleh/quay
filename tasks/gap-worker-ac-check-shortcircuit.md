---
id: gap-worker-ac-check-shortcircuit
title: worker exit 0 后 fan-in 前短路查 AC 未全勾——漏勾 AC 不再烧整条 fan-in + 锁排队（机制兜底）
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

漏勾 AC 的机制级短路。worker exit 0 后、`finishAsync`（`worker-driver.ts:1633`）spawn 机械 fan-in **之前**，先查 AC（`countCompletionCheckboxes` 已存在，`worker-driver.ts:983`）；未全勾 ⇒ 不启动 fan-in，直接 exited-not-landed + 原因明确写「AC 未全勾，续做只需验证并勾选」，省整条 fan-in + 锁排队。与 `gap-worker-dispatch-prompt-ac-check-instruction` 互补：A 打根因（prompt 教勾），B 兜底（任何残留漏勾早发现、低代价）。

## Plan

`finishAsync` 在 spawn 机械 fan-in 前调用 `countCompletionCheckboxes` 查 worktree 任务体 AC；未全勾 ⇒ 短路 exited-not-landed + 明确原因，不 spawn fan-in。AC 全勾 ⇒ 照常 fan-in。

## Acceptance Criteria

- [x] AC_B1（机制级，能取假）：构造 AC 未全勾的 worker 退出 ⇒ 不 spawn fan-in（spawn 计数 0）、outcome 原因含「AC 未全勾」；（⛔ 仍 spawn fan-in ⇒ 假）。发生率窗：判据只计本任务落地后的事件（硬规则 4 推论三）。
- [x] AC_B2（能取假，无回归）：AC 全勾时行为不变（fan-in 照常 spawn、跑通）；（⛔ 全勾也被短路 ⇒ 假）。

## Definition of Done

`finishAsync` 在 spawn 机械 fan-in 前查 AC 未全勾即短路 exited-not-landed（原因含「AC 未全勾」）；AC_B1/B2 勾；未全勾不烧整条 fan-in；全量 suite 绿。

## Touches

- plugin/scripts/worker-driver.ts（finishAsync 短路）
- plugin/test/worker-driver-fan-in.test.mjs（worker-driver fan-in 相关测试）
- plugin/test/worker-driver.test.mjs（AC1 exit-0-not-landed 测试回归：gap-wt 任务体补全勾 AC/DoD）
- tasks/gap-worker-ac-check-shortcircuit.md（自身）

## Needs-Human

**执行 2026-09-01T07:17:13.111Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
