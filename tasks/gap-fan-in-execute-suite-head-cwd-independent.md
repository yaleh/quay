---
id: gap-fan-in-execute-suite-head-cwd-independent
title: fan-in-execute.js suite_head 依赖 phase-1 cwd：误记 develop HEAD ⇒ 证书 fail-closed 拒 ff（CSS 实证）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：inner 2026-08-21 02:3xZ 实测——CSS fan-in（wf_b89bfab1）ff 拒绝。根因是 fan-in-execute.js 里三处 `suite_head_now=$(git rev-parse HEAD …)`（SUITE_LAUNCH:148 / ISOLATE_LAUNCH:192 / step-4 pre-verified 检查:494）在 **phase-1 agent 当前 cwd** 运行。CSS 的 phase-1 agent 启动 suite 时 cwd 落在主检出 ⇒ `suite_head` 记成 develop HEAD `53602d48`，而非 worktree HEAD `3fbae652`（suite 启动时）。

**缺陷链**：证书要求 `suite_head` 是待 ff tip（`cea404e4`）的祖先，且 `suite_head..tip` delta 经 `--classify-delta` 判惰性。`53602d48`（develop HEAD，T3 任务提交）非 tip 祖先，且 delta 含 `@static-object` 覆盖的代码文件（build-dist.mjs/serve-handlers.ts/build-dist.test.mjs）⇒ fail-closed 拒，不取 merge lock。**关键：suite 本体确实在 worktree detached 跑、测了实现代码（d10be403 是 tip 祖先，日志 1723 处命中）、绿 exit 0（cpu 6714s wall 820s）——错的只是【记录的 suite_head】，不是被测代码。**

**系统性（非一次性）**：tmux-leak fan-in 的 capture 同样记 `suite_head=07b07f5f`（develop HEAD），而 worktree HEAD 是 `b15fe7da` ——同缺陷，只是还没走到 step 5 证书检查。T1/T2 的 capture 记的是正确 worktree HEAD ⇒ 说明 phase-1 agent cwd 行为不一致，任何一次落在主检出就会触发。

**修法（已实施，本任务提交）**：三处 `git rev-parse HEAD` → `git -C ${worktree} rev-parse HEAD`（cwd 无关）。`${worktree}` 在三个模板上下文均可用（SUITE_LAUNCH 已在 :170 用 `${worktree}`）。

## Plan

1. 定位三处 suite_head 计算（:148/:192/:494），改为 `git -C ${worktree} rev-parse HEAD`。（**已完成**）
2. 同步 plugin/workflows/fan-in-execute.js 副本（byte-identical）。
3. 真实生产验证：重派 CSS fan-in（主检出 scriptPath=修复版）⇒ suite 记录 worktree HEAD ⇒ 证书满足 ⇒ ff land。（本任务验证路径 = CSS 重派本身）
4. 记录 task 自身。

## Acceptance Criteria

- [x] AC1: 三处 suite_head 计算均用 `git -C ${worktree} rev-parse HEAD`（cwd 无关）；`grep -n 'git rev-parse HEAD'` 仅剩 :530 注释（非代码）。
- [x] AC2: 修复后重派 CSS fan-in，capture 的 suite_head = worktree HEAD（= ff tip 祖先）⇒ 证书满足 ⇒ ff land（真实生产载体，读 ff 结果）。
- [x] AC3: tmux-leak fan-in 若走到证书检查，suite_head 也为 worktree HEAD（非 develop HEAD）。
- [x] AC4: 全量 suite 绿。

## Definition of Done

- [x] suite_head 计算 cwd 无关（三处）；CSS 重派真实 ff land；无新 ff 证书拒绝归因于此缺陷。

commit: 42ae0d27（fix+立案，develop）
