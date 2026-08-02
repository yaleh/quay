# 快速模式 loop tick 指令

**这是一份 tick 指令，不是驱动器。** `/loop` 每次触发就执行一遍下面的步骤，然后重新排程。

**调用方式**（`.claude/loop.md` 已删除——exp5 退役；`/loop` 带显式 prompt 时不读该文件）：

```
/loop 执行 docs/analysis/fast-mode-loop-tick.md 中的 tick 指令
```

---

## 定位：看护，不是调度

exp6 §9 把 loop 降级为**跨会话行为稳定层**。这份 tick 兑现那个定位：

| loop 做 | loop 不做 |
|---|---|
| 会话 idle 时把停摆的队列推进一步 | 轮询后台 agent 是否完成 |
| compact / `/clear` 后从队列文件恢复状态 | 决定任务优先级 |
| 触发停止条件时停下并报告 | 替人做合并冲突/审查失败的判断 |

**后台 agent 完成时会自动触发 `<task-notification>` 重新唤起会话**——那是主要的推进信号。这个 tick 是**兜底心跳**，处理「会话 turn 结束了但队列还有活」的情况。因此间隔应长（20–30 分钟），不是快轮询。

## 状态单一来源

`docs/analysis/batch2-queue-state.md`

每个 tick 结束**必须**写回该文件。它是 compact 后唯一可信的状态——不要靠记忆。

## 停止哨兵

`.halt`（仓库根）

exp5 已退役（`.claude/loop.md` 已删除），`.halt` 从「暂停 exp5 循环」改为**快速模式的唯一停止开关**。
存在即暂停；移除即放行。

移除前跑 `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`——
它检查工作树干净、无半途 merge、master 未被占用等硬条件。注意它有一条是「working tree clean」，
而快速模式下开发会话本就在 master 上工作，所以**在飞任务未落地时它会 FAIL 是预期的**，
不是故障；等在飞任务合并完、树干净了再移除。

---

## Tick 步骤

### 0. 哨兵

`.halt` 存在 → 本 tick 空转，报告「已暂停」，重新排程，结束。

### 1. 读状态

读队列文件。若与 `git log` / `git worktree list` 不一致，**以 git 为准**并修正文件——文件可能是 compact 前的旧快照。

### 2. Fan-in 已返回的任务（合并串行，全量套件批量）

**先逐个合并，再统一跑一次全量套件。**

对每个已返回但未合并的 subagent，逐个：

1. `git merge --no-ff task/<taskId>`
2. 冲突 → `git merge --abort`，标 needs-human，**停止本 tick 的后续合并与派发**，报告
3. 跑 `scripts/test.sh --for-task <taskId>`（该任务自己的选中集，秒级）
4. 选中集非绿 → 回退该 merge，标 needs-human，停止，报告

全部合并完成后，**跑一次**全量 `scripts/test.sh`：

5. 非绿 → **立即停止**，不再合并任何东西；逐个回退或 `git bisect` 定位是哪个 merge 导致，报告
6. 绿 → 对每个已合并任务：`git worktree remove` + `git branch -d`，关闭任务状态（AC 和 DoD 都勾；勾不上写理由或留 `ready`），记录耗时

**为什么批量：** 全量套件 ~7 分钟（418s 实测）。逐个合并各跑一次，3 个任务就是 21 分钟纯重复。批量后 7 分钟。B2/B3 这批 5 个任务在旧方式下花了约 35 分钟在重复跑同一套件上。

**不削弱任何断言**——合并仍逐个、每个仍有选中集把关、全量仍然跑，只是把全量的验证点从「每次合并」移到「一批合并」。红了用 bisect 定位，比省下的时间便宜。

**合并本身必须串行。** 并发合并会在共享工作树上撞车。

### 3. 检查停止条件

任一满足 → 不派发新任务，报告后重新排程：

- `.halt` 存在
- needs-human 积压 ≥ 3
- 上一步全量 suite 非绿
- 有未解决的合并冲突
- 就绪队列为空

### 3.5 计量（强制，不可跳过）

派发前对每个任务：

```bash
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --task-start --taskId <id>
# 记下打印的 runId
```

fan-in 关闭任务时：

```bash
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts \
  --task-end --taskId <id> --runId <r> --outcome <done|needs-human|abandoned>
```

**这不是可选步骤。** 工具在 B2-1 造好并合并了，但截至 2026-08-02 11:08 `--report` 返回
`{tasks: [], tasksPerHour: 0}`——一次都没被调用过。所有耗时数字仍靠 commit 时间戳反推，
正是这个工具本该消除的考古。

没有计量，「1 任务/小时」无法判定，也无法知道任何优化是否真的有效。

### 4. 派发就绪任务

并发上限 **3 个在飞 subagent**（含本 tick 之前就在跑的）。

派发前对每个候选：

- 依赖满足（父任务/前置任务已 done）
- 与**所有在飞任务**做 `checkTouchesPair`——重叠则跳过，等下一 tick

派发形态见 `docs/analysis/fast-mode-batch2-prompt.md`：后台 `Agent(run_in_background)`，subagent 自建 `/tmp/quay-wt-<slug>` worktree 和 `task/<id>` 分支，内部起独立对抗审查（硬上限 2 轮），只提交不合并。

### 5. 写回状态

更新队列文件：已完成 / 在飞（含 worktree 路径和派发时刻）/ 待执行 / 计量表 / 本 tick 做了什么。

### 6. 重新排程

`ScheduleWakeup`，间隔 **1200–1800 秒**。理由：后台完成有 task-notification 自动唤起，这只是兜底。

---

## 无人值守期间的判断边界

以下**一律停下等人**，不要自行决定：

| 情况 | 动作 |
|---|---|
| 合并冲突 | abort，needs-human，停止派发 |
| 全量 suite 非绿 | 立即停，不再合并 |
| 对抗审查 2 轮后仍 REFUTED | 标 needs-human，停止该任务 |
| 任务超 90 分钟 | 中止 subagent，needs-human，不带内重试 |
| needs-human 积压 ≥3 | 停止派发新任务 |
| 队列文件与 git 状态矛盾且无法判定 | 停，报告两边的实际内容 |

这是**保守默认**。ADR-021 原则：不要在证据不足时把策略机械化。这些判断目前由人做，等积累了足够多的真实案例再考虑规则化。

## 每个 tick 必报

- 本 tick 合并了什么、派发了什么
- 在飞任务及其已运行时长
- 停止条件是否触发、触发了哪条
- 计量表当前行数与均值

不要只说「继续中」——没有这些数字，1 任务/小时的目标无法判定。
