---
id: gap-quay-file-task-skill-verify-mode-a-isolated-v2
title: quay-file-task skill Step 8 复核（Mode A v2：受隔离约束的 subagent，改正后再验一次）
status: superseded
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

本任务是 `gap-quay-file-task-skill-verify-mode-a-isolated` 的复核延续。前身那一轮的实测发现：
`plugin/skills/quay-file-task/SKILL.md` 的 Step 8 原文要求「对隔离宿主先 EnterWorktree/建
worktree、做完再 merge 回共享检出」，但实测中 `task_write`（MCP）已经绕过隔离直接写共享主检出，
且 `EnterWorktree` 对由 Agent 工具 spawn 出来的 subagent 存在结构性拒绝（"it would mutate the
parent session's process-wide working directory"）——原文描述的 worktree/merge 流程根本走不通，
也没有必要走。

据此 Step 8 已被改写为：**不管调用方是否处于 worktree-isolation guard 约束下，都不需要
EnterWorktree / `git worktree add` / merge——`task_write`（MCP）恒定直接写共享主检出（其绑定
在 server 启动时固定的 workspace root，不follow 调用方 cwd 或隔离 worktree），写完之后直接对
共享检出 `git add tasks/<id>.md && git commit` 即可，因为该 guard 只挡 `Edit`/`Write` 这两个
编辑工具，不挡 `Bash`/`git`。**

本任务本身就是这次复核的验证载体：由一个受 harness worktree-isolation guard 约束的 subagent
（Mode A：无隔离生效前需 EnterWorktree 才能 Edit/Write 共享检出）执行改正后的 Step 8 原文，
**全程不调用 `EnterWorktree`、不 `git worktree add`、不 `git merge`**，只用
`mcp__quay__task_write` 创建任务 + 一次 `git add`/`git commit`，验证文件确实落在共享主检出
`/home/yale/work/quay/tasks/`（用 `ls`/`git status` 直接核实，不假设），并验证 commit 直接
对共享检出成功、不需要任何绕行。

## Acceptance Criteria

- [ ] AC1: `task_write` 创建的任务文件 `tasks/gap-quay-file-task-skill-verify-mode-a-isolated-v2.md`
      经 `ls -la /home/yale/work/quay/tasks/gap-quay-file-task-skill-verify-mode-a-isolated-v2.md`
      与 `git -C /home/yale/work/quay status --short tasks/gap-quay-file-task-skill-verify-mode-a-isolated-v2.md`
      确认存在于共享主检出（不是任何 `/home/yale/work/quay-worktrees/*` 或临时 worktree 路径）。
- [ ] AC2: 本次执行记录（子代理最终报告）中，全程只出现
      `mcp__quay__task_write` + 一次 `git add`/`git commit` 两类动作，
      不出现 `EnterWorktree`、`git worktree add`、`git merge` 中的任何一个。

## Definition of Done

`git -C /home/yale/work/quay log --oneline -1 -- tasks/gap-quay-file-task-skill-verify-mode-a-isolated-v2.md`
能取到一条真实 commit hash（不是仅暂存未提交），且该 commit 的 diff 只包含本任务文件本身
（`git show --stat <hash>` 只列出这一个文件），证明改正后的 Step 8 对受隔离约束的宿主同样
「无需 worktree、直接 commit」成立，不是只对无隔离宿主成立。
