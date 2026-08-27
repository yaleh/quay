---
id: gap-fan-in-continue-prompt-not-migrated-to-mechanical
title: fan-in 机械编排续做路径未迁移——续做 worker 仍走旧 workflow 而非机械 fan-in + 冷启动孤儿误路由
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

fan-in 机械编排的「续做路径」没迁移——续做任务仍走旧 workflow 而非机械 fan-in。

**缺陷**：`worker-driver.ts` 两个 worker prompt 两条路：
- `buildWorkerPrompt`（新建 :843）→ `driverFanInNote()`（:851，机械 fan-in：worker 实现后退出、driver 接手跑锁/merge/delta/typecheck/scoped门/suite/ff）。
- `buildContinueWorkerPrompt`（续做 :1045）→ 仍用 `fanInSignature()`（:1062，旧 workflow 指令：worker 自己去调 `.claude/workflows/fan-in-execute.js`）。
`workerPromptForTask`（:1070）按「worktree 在不在」择一：worktree 已存在 ⇒ 续做 ⇒ 必走 workflow。`git log -S driverFanInNote` 显示它只在 a35433919（机械 happy-path）引入一次、只接进新建路径，从没碰续做 prompt。

**第二个缺陷（同源）**：续做路径只在「worktree 存在」触发，无法区分两种成因：① 机械 fan-in 真跑过且红了（应 workflow 语义兜底，worker-outcome 有 mechanical_fan_in.outcome=red）；② 冷启动孤儿/上一轮旧 regime（机械 fan-in 从没跑过，应走机械）。② 被误路由到 workflow，跳过机械 fan-in。

**实证**：gap-full-suite-runner-test-poll-timeout-load-flake 是成因②：worker-outcome 对该任务 grep -c = 0（机械 fan-in 从没产生记录），续做失败原因 (unknown)，自 15:32 起挂 cold_start_inflight（旧 driver 孤儿）。当前 worker 按续做 prompt 调 fan-in-execute workflow，16:17:53 acquire 工作锁、至今未 release——正是机械编排要消灭的旧形态（子代理串行跑机械步骤 + 锁恒 ~30min）。

## Plan

1. 续做 prompt 也换 `driverFanInNote()`（worker 永不自己调 workflow）。
2. workflow 兜底改为 driver 的决定——runMechanicalFanIn 返回 red 时按 step（suite 红/typecheck 红/merge 冲突等语义失败）唤起语义会话，而非把「调 workflow」写进下一轮 worker 的 prompt。
3. 重试上限（advanceRetryCap/markNeedsHuman）已能兜机械重复失败。

## Acceptance Criteria

- [ ] AC1（能取假，续做走机械）：buildContinueWorkerPrompt 用 driverFanInNote()（⛔ 仍 fanInSignature ⇒ 假）。
- [ ] AC2（能取假，冷启动孤儿不误路由）：成因②（worker-outcome 无 mechanical_fan_in 记录）走机械 fan-in（⛔ 误走 workflow ⇒ 假）。
- [ ] AC3（能取假，语义兜底归 driver）：workflow 兜底由 driver 按 red step 唤起语义会话（⛔ 把「调 workflow」写进 worker prompt ⇒ 假）。

## Definition of Done

续做 prompt 迁移到机械 fan-in；AC1-AC3 全勾；冷启动孤儿不再误走 workflow；worker 永不自己调 workflow。

## Touches

- plugin/scripts/worker-driver.ts（buildContinueWorkerPrompt 迁移 driverFanInNote）
- plugin/test/worker-driver.test.mjs（续做 prompt 机械 fan-in + 冷启动孤儿路由测试）
- tasks/gap-fan-in-continue-prompt-not-migrated-to-mechanical.md（自身）
