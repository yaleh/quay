---
id: gap-worker-prompt-note-family-slimming
title: worker prompt note
  族（buildWorkerPrompt/buildContinueWorkerPrompt）瘦身——指针+短指令去重，不整段删事故反制
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/worker-driver.ts` 的 `buildWorkerPrompt` / `buildContinueWorkerPrompt` 由一串 note 拼成：`acCheckNote` / `darkAxisRecordNote` / `preMergeNote` / `antiDriftPreExitNote` / `bashWriteTargetGuardNote` / `experimentResumeClause` / `driverFanInNote`。每条都是整段英文，随每条 worker 创建/续做 prompt 逐字重发，贡献 fresh_input（1× 计费）且随 220 轮长会话反复出现。这些 note 是历史事故的反制（如 `antiDriftPreExitNote` 反制 162 次「一条会话修 Touches 越界」），⛔ 不能整段删除——但可以 (a) 合并重叠指令、(b) 把内容已活在任务体/正本里的 note 改成指针+短指令、(c) 去重，把「必须逐字在场的仲裁指令」收敛成一个最小不变量集。

## Plan

1. 先给 buildWorkerPrompt + buildContinueWorkerPrompt 的输出长度落一个已提交基线（字符数，测试读数）。
2. 逐个 note 判「逐字必须在场」vs「可改指针」：worktree 绝对路径护栏、task_write-not-hand-edit、anti-drift argv、driverFanInNote 的「exit」是仲裁指令，必须保留逐字；其余说明性/背景性文字压成短指令或指向任务体/正本。
3. 复用去重：同一指令在创建与续做 prompt 里重复出现处，收敛为单一来源。

## Acceptance Criteria

- [ ] AC1 新增/扩展一个测试，断言 `buildWorkerPrompt` + `buildContinueWorkerPrompt` 合并输出字符数较基线下降 ≥ 25%（基线在实现第一步先提交）。
- [ ] AC2 负控制（不变量集）：合并输出仍逐字包含至少这四根针——worktree 绝对路径护栏关键词、`task_write`（非 hand-edit checkbox）、anti-drift 的 argv 命令、`exit — the worker-driver takes over`（grep 逐字）。
- [ ] AC3 一个真实 worker spawn 的 prompt（`worker-outcome.jsonl` 或 transcript 读出）能跑通、且 AC2 的针仍逐字在场（贴 prompt 长度与 grep 命中）。

## Definition of Done

- AC1–AC3 带真实证据勾选；baseline 提交在 git 里可查。
- 任何 note 的「事故反制」语义（护栏/ABI/anti-drift/exit）逐字保留，仅删/压背景与重复文字。

## Touches
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-worker-prompt-note-family-slimming.md