---
id: gap-quay-file-task-skill-verify-mode-a-isolated
title: quay-file-task skill 验证任务（Mode A：受 harness 隔离约束的后台 subagent 路径）
status: superseded
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

这是 `plugin/skills/quay-file-task/SKILL.md` Step 8「Isolated background session」路径（Mode A：受 harness
worktree-isolation guard 约束的后台 subagent）的实测验证任务。由一个通过 `Agent` 工具 spawn 的 subagent
创建，用于回答上一轮对话（skill 作者）留下的开放问题：**在隔离 worktree 里调用 `task_write` MCP 工具时，
文件到底落在【隔离 worktree 自己的 `tasks/` 目录】还是【共享主检出 `/home/yale/work/quay/tasks/`】？**

实测过程与结果（按发生顺序）：

1. **guard 确认**：本 subagent 对共享检出 `/home/yale/work/quay/.quay-guard-test-probe.tmp` 做 `Write`，
   被 harness 明确拦下，错误信息：`This subagent's parent bg session hasn't isolated yet, so writes to
   the shared checkout are blocked.` ⇒ 本 subagent 确属「受 harness 隔离约束」的一类（Mode A 的前提成立）。

2. **`EnterWorktree` 工具本身在本类 subagent 上不可用**：调用 `EnterWorktree({name: ...})` 返回
   `EnterWorktree cannot create a worktree from a subagent with a cwd override (isolation: "worktree" or
   explicit cwd) — it would mutate the parent session's process-wide working directory. To work in a
   different directory (including a worktree), spawn an Agent with \`cwd\` set to it.`
   ⇒ 通过 `Agent` 工具 spawn 出来的 subagent（本任务这种）自带一个被钉住的 cwd（等同于 `explicit cwd`
   或 `isolation:"worktree"` 语义），而 `EnterWorktree` 的创建路径明确拒绝在这类 subagent 上执行——
   **这与 Step 8 文档描述的「Isolated background session: 先用 EnterWorktree 隔离」这条路径本身矛盾**：
   对这一类真实存在的宿主（Agent 工具 spawn 的 subagent），`EnterWorktree` 结构上不可用，工具自己给出
   的替代方案是「换用手动 `git worktree add`」或「换一个带显式 `cwd` 的全新 Agent spawn」——都不是
   「先调 `EnterWorktree`」。

3. **回退到手动 `git worktree add`**（Step 8 本就承认的备选路径「先隔离(EnterWorktree 或手动 worktree)」）：
   `git worktree add /home/yale/work/quay-worktrees/gap-quay-file-task-skill-verify-mode-a
   -b task/gap-quay-file-task-skill-verify-mode-a develop`。分叉基准新鲜度实测：
   `git rev-list --count HEAD..develop` = **0**（本次未复现此前记录的「默认基准落后 develop 7837 个提交」
   的问题——因为本次是显式 `... develop` 手动指定基准，不是走 `EnterWorktree` 的默认 `fresh` baseRef
   逻辑；`EnterWorktree` 那条默认逻辑本身在本次实测中完全没有被执行到，因为它在第 2 步就被工具拒绝了）。

4. **关键观测：`task_write` 落盘位置**。本 subagent 的 Bash 会话 cwd 全程是 `/home/yale/work/quay`
   （共享检出——即使 `cd` 进隔离 worktree 执行 `git` 命令，那只在单条 Bash 命令内的子 shell 里生效，
   不改变会话级 cwd，这一点与工具描述「Working directory persists between calls」在「同一条命令内
   `cd &&`」这种用法下并不生效，是本次实测顺带确认的另一个事实）。调用本条 `task_write` 之后：
   - `ls /home/yale/work/quay-worktrees/gap-quay-file-task-skill-verify-mode-a/tasks/gap-quay-file-task-skill-verify-mode-a-isolated.md`
   - `ls /home/yale/work/quay/tasks/gap-quay-file-task-skill-verify-mode-a-isolated.md`
   两条 `ls` 的结果由本 subagent 在写完之后立即核对并写入交付报告（不在 body 内预先断言，因为写这段
   body 的时刻文件还没写完——避免自证）。

**结论待并入交付报告**：本 Finding 只记录「机制上已验证的事实」，具体落盘路径的 `ls`/`git status`
证据由 spawn 本任务的 subagent 在完成 `task_write` 调用后直接在其对上级的报告里给出，不重复写入本任务体
（避免任务体内容与外部报告出现可能不一致的两份「结论」）。

## Acceptance Criteria

- [ ] AC1：对本任务 id 调用 `task_get`，返回的 `title`/`status`/`labels`/`extra.schema` 与本次
      `task_write` 写入的值完全一致（验证 MCP 写/读路径本身工作正常，与「落在哪个目录」这个问题正交）。
- [ ] AC2（验证记录，非阻塞）：`task_write` 完成后，记录文件的真实落盘路径——是隔离 worktree 自己的
      `tasks/` 目录，还是共享主检出 `/home/yale/work/quay/tasks/`——用一条 `ls` 或 `git status` 的
      直接输出作为证据，写入 spawn 本任务的 subagent 的最终报告（不要求写回本任务体）。

## Definition of Done

本任务的落地形态就是它自己——一条 `status: superseded` 的记录，标明 quay-file-task skill Step 8
Mode A（隔离 subagent）路径已被实测走过一次，`EnterWorktree` 在该类宿主上的真实行为、以及
`task_write` 的真实落盘位置由外部报告给出。不需要额外代码改动或机制修复——本任务是一次纯观测记录。
