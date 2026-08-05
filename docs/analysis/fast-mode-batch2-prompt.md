# 批次 2 执行 Prompt（草稿 — 待确认后发送）

**用法：** 确认后发给开发会话（`quay-0:0.0`）。

---

你在 `/home/yale/work/quay`。本批次开始，把执行方式从「主会话直接实现」切换为**编排 + 后台 subagent 驱动**。你（主会话）不再自己写实现代码。

## 为什么改

批次 1 的 1.4/1.5/1.6 已经证明了这个模式：后台 subagent 在自己的 worktree 里实现，各自跑对抗审查，主会话合并。三个任务的审查分别抓出 3、4、1 个真实 bug——比主会话自审有效得多。本批次把它固化为**默认**，并加上计量和 fan-in 纪律。

## 你的角色：编排，不实现

| 你做 | 你不做 |
|---|---|
| 维护 TodoList 作为队列可见状态 | 写实现代码 |
| 就绪度 + Touches 正交性检查 | 在共享工作树上编辑 |
| 派发后台 subagent | 替 subagent 做技术判断 |
| fan-in：串行合并 + 全量测试 | 并行合并 |
| 记录每任务耗时 | — |

**例外：** 第 0 项（补 DoD）是 5 分钟的小改，你直接做，不值得派发。

## 派发机制（已验证的形态）

每个任务一个后台 subagent：

```
Agent(run_in_background: true, description: "<taskId>", prompt: <见下>)
```

**worktree**：subagent 自己建，`$WORKTREE_ROOT/<slug>`（磁盘路径——`/tmp` 是 tmpfs、是内存，
worktree 建进去就是在重演整机 OOM；`worktree_root` 从 `.quay/config.yml` `loop:` 节读），
分支 `task/<taskId>`。

```bash
git worktree add $WORKTREE_ROOT/<slug> -b task/<taskId>
```

注意 `milestone-worktree.ts` **不能用**——它要求数字 milestone 号，本批次任务都是 gap 任务没有 M 号。用上面的裸 `git worktree`，这正是批次 1 实际用的。

**subagent 的 prompt 必须包含：**

1. 任务 id 和 `tasks/<id>.md` 路径
2. 先读真实代码，任务体可能与代码矛盾——发现矛盾先修任务体
3. RED/GREEN：先写测试再实现
4. **实现完成后，起一个独立的审查子代理**（嵌套 depth-2，已验证可用），要它**反驳**而非确认，它必须自己跑测试自己读代码
5. 修审查发现的真实问题，需要就再来一轮，**硬上限 2 轮**
6. 镜像字节一致（`cmp -s A B`）
7. 任务内只跑局部测试（`## Touches` 命中的文件），**不要跑全量**
8. 在自己的分支上 commit，**不要合并**——合并是主会话的事
9. 返回：分支名、commit sha、测试结果、审查抓到了什么、AC/DoD 逐条自评

## fan-in（你做，串行）

subagent 返回后，按完成顺序逐个：

1. `git merge --no-ff task/<taskId>`，冲突就中止并报告，不要 `--ours`/`--theirs`
2. 跑该任务的**选中集** `$TEST_COMMAND --for-task <taskId>`（`TEST_COMMAND` 见 `.quay/config.yml` `loop.test_command`；秒级，按 `## Touches` 选测试）——**不跑全量**
3. 选中集非绿才停下来定位；绿才继续下一个合并
4. `git worktree remove $WORKTREE_ROOT/<slug>` + `git branch -d task/<taskId>`
5. 关闭任务状态（见下）
6. 记录耗时

> **全量套件不在此处跑**（`gap-two-thirds-of-a-task-is-polling-a-suite-log` 方向 C）：迭代/fan-in 只用
> `--for-task` 选中集把关，**全量只留给 DoD 要求的最后连跑 2 次全绿**——那是「有没有破坏别处」的唯一回答。

**合并必须串行。** 并行合并会在共享工作树上撞车——这个会话见过真实事故。

## 计量（本批次手工，下批次起用工具）

任务 1 造的就是计量工具，所以本批次它自己没得用。手工记录，写进 TodoList 或一个临时表：

```
taskId | 派发时刻 | 返回时刻 | 合并时刻 | 分钟数 | 审查轮次 | 审查抓到几个真问题
```

批次结束时把这张表贴出来。目标是**平均 ≤60 分钟/任务**；本批次可并发，所以墙钟应该明显低于串行总和。

## 任务状态关闭（纪律已加严）

标 `done` 前：

- **AC 段和 DoD 段都要逐条勾**——上一轮的口子正出在只勾了 AC 段（`DIR-124-F-plancheck` AC 6/6 但 DoD 0/2 就标了 done）
- 勾不上的**逐条写明理由**
- 某条要求真实 dispatch 验证 → 保持 `ready` 并写明还差什么
- 跑 `task-status-drift-check.ts` 复核

## 本批次任务

### 第 0 项（你直接做，~5 分钟）

`DIR-124-F-plancheck` 的 DoD 有 2 条未勾且无说明：

```
- [ ] Tests pass: PlanCheck emits typed findings with correct classification for known fact classes
- [ ] Legacy callers (receipt, checkpoint) still read `findings` as number without breakage
```

两条都可测，不需要真实 dispatch。跑测试验证并勾上；若确实不成立，把 status 改回 `ready` 并写明。

### 第 1 项（串行，必须先完成）

**`gap-fast-mode-no-telemetry`**

计量工具。**必须最先**——第 2、3 项的验收都要它在位（第 2 项 AC12 要「实测选中集 vs 全量对比」，第 3 项要判断提速是否有效）。

关键约束（任务体已写）：复用现有的 `workflow-event-schema.mjs`，**不要发明第二套事件格式**。

### 第 2、3 项（第 1 项合并后，并发派发）

**`gap-test-selection-not-scoped-to-touches`** 和 **`gap-suite-speedup`**

Touches 不相交，可并发：
- 前者动 `select-tests-for-touches.ts`（新）+ `scripts/test.sh`
- 后者动 `packages/quay-github/test/` 三个文件

派发前用 `touches-orthogonality-check.ts` 复核这个判断，不要只信我说的。

第 3 项的优先级已下调：全量套件实测 **417s（7 分钟）**，不是之前以为的 15 分钟以上。三个热点合计约 2 分钟，占 30%。若第 2 项完成后你判断收益不足，可以说明理由后暂缓，不必硬做。

## 硬性约束（不变 + 新增）

1. 读真实代码，不信任务体
2. RED/GREEN
3. 独立子代理对抗审查，要它反驳；**硬上限 2 轮**（新增）
4. 镜像字节一致
5. 任务内只跑局部测试，全量只在 DoD 最后两次
6. 新增导出函数必须有生产调用点，否则不算完成
7. **AC 和 DoD 都要勾**，勾不上逐条说明（加严）
8. 发现异常必须处置——修，或建任务；降级必须同时建任务
9. **单任务硬上限 90 分钟**（新增）：subagent 超时就中止并报告，不要在带内重试
10. **needs-human 积压 ≥3 就停止派发新任务**（新增），报告等确认
11. 每个任务独立提交

## 完成后

停下报告，不要自动进入下一批次。报告包含：

- 计量表（上面那张）
- 每个任务的审查抓到了什么
- 全量套件最终状态
- 仍未关闭的 status-drift-suspect

---

## 附：关于 Workflow 工具

本批次**不用** Claude Code 的 `Workflow` 工具，用 `Agent(run_in_background)`。理由：3 个任务、一条串行依赖，写 Workflow 脚本的开销大于收益（ADR-021 原则 1——元机制要比它管理的对象机制简单）。

Workflow 值得用的时机是：单批次任务数上到 6+，或者派发逻辑本身需要确定性可重放。到那时再从这个批次的实际形态提炼成脚本，而不是现在预先设计。
