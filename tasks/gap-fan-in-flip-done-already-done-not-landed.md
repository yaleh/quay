---
id: gap-fan-in-flip-done-already-done-not-landed
title: "flip-done「已 done 未落地」不收敛——fan-in 在 ff 前翻 done、ff 失败后重跑撞「expected exactly
  1 status: ready」；driver 自主重试路径会卡死到 needs-human"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`runMechanicalFanIn` 的 flip-done 步只接受 `status: ready`（`flipTaskDone` 期望「exactly 1 'status: ready' line」）。**「已 done 未落地」的中间态会让重跑直接红**：

- 步骤 8 先 flip 到 done（人 2026-08-14 裁定「先 flip 后 ff」），步骤 9 ff 若失败（脏主检出 / token 闸 / merge-mode 干净判据拒），worktree 分支已带 done-flip 提交、develop 未落地。
- 重跑（driver maxRetries 的 re-dispatch 或手动重跑）时，merge-develop 把 worktree 的 done-flip 保留，flip-done 找不到 `status: ready` ⇒ `expected exactly 1 'status: ready' line, got 0` ⇒ 红。
- **driver 自主重试路径会撞**：exited-not-landed 后 spawn 新 worker（continue prompt 在现有 worktree），worker 退出后 runMechanicalFanIn 重跑 → flip-done 红 → 又 exited-not-landed → 3 次后 needs-human。任务被一个「可重试的 ff 失败」卡死。

**实证**：manager 2026-08-28 手动 fan-in v3（force-color）——v2 已在 worktree 翻 done（5763dbb23）但 ff 因脏主检出失败，v3 重跑撞 `expected exactly 1 'status: ready' line, got 0`（red@flip-done）。修法当时是手动 `git` reset worktree 任务文件 done→ready + 提交（c0624a546），再重跑 v4 才落地。

**机制判据**：`status=done` 的完整语义 =「落地」（status done ∧ develop 含提交 ∧ 无残留 worktree，`computeLandingState`）。「worktree 分支 done 但 develop 未落地」是**不一致中间态**（flip 已发生、ff 未成功），fan-in 应在重跑时识别并收敛，而不是让任务卡死在 needs-human。

## Plan

1. **flip-done 容忍「done 但未 landing」**：`flipTaskDone`（或 runMechanicalFanIn 的 flip 步）在读到 `status: done` 时，先判「是否真落地」——若 develop 不含本任务的落地提交（`computeLandingState`/`git merge-base` 检查 task 分支 tip 是否在 develop 祖先），则视为不一致中间态，**reset worktree 任务文件到 ready 再 flip**；若已真落地则跳过（不重翻）。
2. **或者（更简单）driver 侧**：re-dispatch exited-not-landed 任务时，spawn 前若检测到 worktree 任务文件 `status: done` 而 develop 未含落地提交，先 reset 到 ready。与 ① 二选一，倾向 ①（判定在判定点，不依赖派发侧）。
3. ⛔ 不推翻「先 flip 后 ff」（2026-08-14 人裁定）——保持顺序，只加重跑侧的收敛。

## Acceptance Criteria

- [x] AC1（能取假，收敛）：对「worktree done-flip 提交 + develop 未落地」的 worktree 重跑 runMechanicalFanIn ⇒ 不红在 flip-done，正常落地（⛔ 仍 `expected exactly 1 'status: ready' line` ⇒ 假）。
- [x] AC2（能取假，真落地不重翻）：status=done 且 develop 已含落地提交的任务重跑 ⇒ 不 reset、不重翻（⛔ 被 reset 到 ready 或重复 flip ⇒ 假）。
- [x] AC3（能取假，driver 自主重试不被卡）：exited-not-landed（flip-done+ff 失败）任务走 driver maxRetries 重试能收敛（⛔ 重试仍红 flip-done 到 needs-human ⇒ 假）。
- [x] AC4（能取假，负控制）：正常 `status: ready` 任务的 flip-done 行为不变（⛔ 破坏正常 flip ⇒ 假）。

## Definition of Done

flip-done 对「done 但未 landing」的不一致中间态自动收敛（reset→flip）；真落地不重翻；driver 自主重试不被 flip-done 卡死；正常 flip 不变；AC1-AC4 全勾。

## Touches

- plugin/scripts/worker-driver.ts（flipTaskDone / runMechanicalFanIn flip 步：done-但-未-landing 检测 + reset）
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs（flip-done 收敛 + 真落地负控制测试）
- tasks/gap-fan-in-flip-done-already-done-not-landed.md（自身）
