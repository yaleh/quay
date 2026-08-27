---
id: gap-worker-leaks-implementation-to-main-checkout
title: worker 实现泄漏到主检出（file-tools 不感知 shell cd、未用 worktree 绝对路径）——fan-in 锁被自己脏树卡死重派循环
status: needs-human
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

> **needs-human（2026-08-27，自指死锁）**：本修复是自指死锁——修 worker-driver 泄漏 bug 需要 worker 实现，但 bug 未修时 worker 自己的 Read/Edit/Write 也会落主检出（泄漏）⇒ worker 修不了自己。需**人直改** `worker-driver.ts:825-837 buildWorkerPrompt`（+ `buildContinueWorkerPrompt` 续做版同源）——加一句强制「所有 Read/Edit/Write 的 file_path 一律用 worktree 绝对路径，file-tools 用绝对路径不感知 cd，禁用主检出路径与相对路径」。**主 seam = prompt 未强制 worktree 绝对路径**；`worker-driver.ts:1311` spawn `{ cwd: rootDir }` 是对的（worker 得在主检出跑 git worktree add）；`dispatch-worktree-setup.sh` 已 fail-closed。纯 prompt 文本改动，静态 grep 可验证（+ AC1 派 worker 负控制）。Touches 含 worker-driver.ts，resume 前必须处置（本 status=needs-human 防 auto-dispatch）。

## Proposal

per-task worker 的 Read/Edit/Write 用了**主检出绝对路径**而非 worktree 路径，把实现写进了 develop 共享检出（未提交），主检出脏树挡它自己的 ff-merge ⇒ exited-not-landed ⇒ 重派 ⇒ 再泄漏 ⇒ 循环。

**实证（2026-08-26 22:5xZ，非推测）**：fan-in 锁 worker（gap-fan-in-workflow-lock-and-S1）实现泄漏到主检出 6 文件（fan-in-ff-merge.sh +118 行 workflow lock、protocol-check +69 行、test 175 行未跟踪、双 fan-in-execute.js），而 worktree 存在但**干净**（HEAD 仍基址 5655cee25、status 空）⇒ 实现只落在主检出。主检出脏树挡 `git merge --ff-only` ⇒ worker 自己 fan-in 失败 ⇒ 重派循环（2568822→2583695）⇒ fan-in 锁（消 ff-race 的解药）被「脏树挡 ff」卡死——正是它要修的病的同族。

**⛔ 已止损（manager drain + kill worker + outer stash）**：6 文件实现入 stash@{0}，主检出干净，driver halted。但根因未修，resume 后重派必复现。

**根因假设（待 inner 读码确认）**：`file-tools-target-worktree-not-main-checkout` 形态——Claude Code 的 Read/Edit/Write 用绝对路径、不感知 shell `cd`，worker 建了 worktree 但文件工具仍写主检出路径。可能的 seam：① dispatch prompt 未明示「文件工具必须用 worktree 绝对路径」；② `dispatch-worktree-setup.sh` 未把 worker 的默认工作路径切到 worktree；③ worker 建 worktree 失败却继续（未 fail-closed）。

## Plan

1. 读码定位：worker 为什么文件工具落主检出（dispatch prompt / worker-driver spawn 的 cwd / dispatch-worktree-setup.sh provisioning 是否真生效）。
2. 修根因：确保 worker 的 Read/Edit/Write 落在 worktree（prompt 明示 worktree 绝对路径 / spawn cwd / provisioning 校验）。
3. 修后：`git worktree add` 重建 fan-in lock worktree → `git stash pop`（只 stash@{0}）→ commit → resume driver → 重派 fan-in lock。

## Acceptance Criteria

- [ ] AC1（能取假，worker 实现不落主检出）：修后 worker 的 Read/Edit/Write 落 worktree 而非主检出；负控制：派一个测试任务，实现完成后主检出 `git status` 保持干净、worktree 含实现；（⛔ 主检出又脏 ⇒ 假）。
- [ ] AC2（能取假，fan-in lock 落地）：stash@{0} 的实现 pop 到重建 worktree → commit → 重派后 fan-in lock 落地 done，不再 exited-not-landed 循环；（⛔ 仍重派循环 ⇒ 假）。

## Definition of Done

worker 实现不再泄漏主检出（AC1）；fan-in lock 经 stash pop 落地（AC2）；「泄漏→脏树→挡 ff→重派」环结构性断开。

## Touches

- plugin/scripts/worker-driver.ts（spawn cwd / 派发 prompt 明示 worktree 路径）
- plugin/scripts/dispatch-worktree-setup.sh（provisioning 校验是否真切换 worktree）
- plugin/test/（worker 落 worktree 负控制）
- tasks/gap-worker-leaks-implementation-to-main-checkout.md（自身）
