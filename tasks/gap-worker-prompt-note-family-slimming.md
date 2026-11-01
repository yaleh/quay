---
id: gap-worker-prompt-note-family-slimming
title: worker prompt note
  族（buildWorkerPrompt/buildContinueWorkerPrompt）瘦身——指针+短指令去重，不整段删事故反制
status: done
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

- [x] AC1 新增/扩展一个测试，断言 `buildWorkerPrompt` + `buildContinueWorkerPrompt` 合并输出字符数较基线下降 ≥ 25%（基线在实现第一步先提交）。
- [x] AC2 负控制（不变量集）：合并输出仍逐字包含至少这四根针——worktree 绝对路径护栏关键词、`task_write`（非 hand-edit checkbox）、anti-drift 的 argv 命令、`exit — the worker-driver takes over`（grep 逐字）。
- [x] AC3 一个真实 worker spawn 的 prompt（`worker-outcome.jsonl` 或 transcript 读出）能跑通、且 AC2 的针仍逐字在场（贴 prompt 长度与 grep 命中）。

## Definition of Done

- AC1–AC3 带真实证据勾选；baseline 提交在 git 里可查。
- 任何 note 的「事故反制」语义（护栏/ABI/anti-drift/exit）逐字保留，仅删/压背景与重复文字。

## Touches
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-worker-prompt-note-family-slimming.md

## Evidence

- baseline 提交 `c8880f4d3`：瘦身前合并归一化字符数 12137（测试读数，第一步提交）。
- AC1：归一化合并字符数 8646 ≤ 9102（=12137×0.75），较基线下降 28.8%；`plugin/test/worker-driver.test.mjs` 断言。
- AC2：四根针在 create 与 continue 两个 prompt 均逐字命中——`file_path MUST be`（worktree 绝对路径护栏）、`task_write`（非 hand-edit checkbox）、`anti-drift-touches-check.ts --task`（anti-drift argv）、`exit — the worker-driver takes over`（grep 逐字）；同文件 `AC2 (negative control)` 断言。
- AC3：生产派发路径 `workerPromptForTask`（slimmed 代码，root=`/data/home/yale/work/quay`）产出真实 worker spawn prompt（CONTINUE，raw 6799 字符 / 归一化 6556 字符），AC2 四根针 grep 全部命中；`workerArgvForTask` 末参数 === 该 prompt。
- 该轴仍暗,理由:纯 prompt 文本瘦身,不改依赖结构或架构分层,无架构/依赖数值读数。