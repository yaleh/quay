---
id: gap-quay-file-task-skill-verify-mode-b-direct-v2
title: quay-file-task skill Step 8 复核（Mode B v2：不受隔离约束的直接会话，改正后再验一次）
status: superseded
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

`plugin/skills/quay-file-task/SKILL.md` Step 8 第一版把"隔离/不隔离"两条路径都套了一层
worktree+merge 的框架；实测（本任务的前身 `gap-quay-file-task-skill-verify-mode-b-direct` /
`gap-quay-file-task-skill-verify-mode-a-isolated`）发现 `task_write`（MCP）从不跟随调用者的
cwd/worktree、恒定写共享主检出，Step 8 已改正为"两种宿主都直接 commit，不需要 worktree"。

本任务是改正后的复核：Mode B（不受隔离约束的直接会话）——直接在当前会话调用 `task_write`
创建本任务，验证改正后的描述（"task_write 落共享检出 + 直接 git commit，无需任何 worktree"）
本身是否成立、过程是否比第一版更顺畅（无需绕过任何隔离/合并步骤）。

## Acceptance Criteria

- [x] AC1 `task_write` 创建成功，`task_get` 读回一致，文件落共享主检出 `tasks/`（非任何 worktree）
- [x] AC2 落地全程未用 `EnterWorktree`/`git worktree add`/`git merge`——只有 `task_write` + 一次
      `git add && git commit`，与改正后的 Step 8 描述一致

## Definition of Done

纯验证用途。DoD = 本任务与其 commit 本身即证据：一次干净的 task_write→commit，无 worktree 绕行。
