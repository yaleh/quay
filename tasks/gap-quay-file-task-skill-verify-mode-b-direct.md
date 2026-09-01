---
id: gap-quay-file-task-skill-verify-mode-b-direct
title: quay-file-task skill 验证任务（Mode B：不受隔离约束的直接会话路径）
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

这是 `plugin/skills/quay-file-task/SKILL.md` 落地后的验证任务之一（人 2026-09-01 要求：在
Step 8 描述的两种宿主路径下各创建一个验证用任务）。本任务对应 **Mode B——不受 harness
worktree-isolation 约束的会话，cwd 本来就在共享主检出**：本次调用直接从当前会话（未
`EnterWorktree`，未建任何隔离 worktree）用 `task_write` MCP 工具创建本任务，用以实测
Step 8 "Unconstrained foreground/interactive session" 那条路径描述是否与 `task_write`
MCP 的实际行为一致——具体是：`task_write` 是绑定固定 root（`.mcp.json` 启动时的 server
进程 cwd，即共享主检出）还是跟随调用者的 worktree。

创建即置 `status: superseded`，不进入 todo/ready 活跃池，避免干扰真实开发派发。

## Acceptance Criteria

- [x] AC1 本任务文件经 `task_write`（provider=native，MCP）创建成功，`task_get` 读回一致
- [ ] AC2（验证记录，非强制阻塞）确认文件落在共享主检出 `tasks/` 目录（`git status`/`ls`
      可见），而非任何隔离 worktree 的本地副本

## Definition of Done

纯验证用途，无需真实落地对象。DoD = 本任务存在本身即证据：`tasks/gap-quay-file-task-skill-verify-mode-b-direct.md`
在共享主检出可读，`status: superseded`。不安排后续工作。
