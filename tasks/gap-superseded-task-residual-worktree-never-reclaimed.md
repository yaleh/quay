---
id: gap-superseded-task-residual-worktree-never-reclaimed
title: supersede 一个任务时无路径回收其残留 worktree——「有提交 ⇒ 保留」缺时间的另一半
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**`cleanupOrphanWorktree` 的保留规则 `hasCommits !== false ⇒ 保留`（worker-driver.ts）在空间上是对的、在时间上没有另一半：任务后来被 supersede 时，没有任何路径释放那个 worktree。残留因此单调累积，只能靠人工发现并手清。**

### 实证（2026-09-08 manager 手工清理时量出，非推断）

`git worktree list` 15 个任务 worktree 中，**7 个**的任务 `status: superseded`、停摆 1–12 天、共占 **2.1G**；同时另有 6 个根本不在 `git worktree list` 里的磁盘残渣目录（76M）。七个的后继任务**全部已 done**（逐条核过）：

| 残留 worktree | 停摆起 | 后继 | 后继状态 |
|---|---|---|---|
| gap-execution-loop-productization-p2-p4 | 08-31 | gap-bootstrap-land-ff-merge-executor-first | done（其 Touches 逐条写明「从 gap-execution-loop 分支取」，`packages/quay/src/fan-in/ff-merge.ts` + 3 个测试已在 develop） |
| gap-fan-in-ff-merge-token-gate-fail-closed | 08-27 | 同链 | done |
| gap-ff-propagate-structurally-broken-filing-must-target-develop | 08-30 | 人 08-31 裁定反转方向 | 残余价值并入 gap-doc-develop-sync-semantic-conflict-resolution（done） |
| gap-retire-inner-session-hygiene-scripts | 09-01 | gap-retire-inner-hygiene-migrate-helper | done（develop 上 hygiene 脚本剩 0 个） |
| gap-scoped-gate-lpt-order | 09-01 | 自撤回 | 净 diff 为空 |
| gap-session-liveness-signals-perfile-timeout-flaky | 09-02 | gap-lowconc-concurrency-8-starves-bclass-waiting | done |
| gap-suite-scheduler-main-lpt-missing | 09-01 | gap-suite-classification-lpt-scheduler-ts-ization | done |

其中 2 个（ff-propagate 08-30、session-liveness 09-02）停在 `MERGE_HEAD` 未完成的 merge 上，唯一 UU 文件都是任务自己的 `.md`。

### 为什么现有机制都够不着（逐条排除，非「没查」）

`cleanupOrphanWorktree` 只在 worker **异常死亡**（failed / killed）路径被调用，且其判据链是：存活 worker ⇒ 跳过；`taskBranchHasCommits` 为 true 或 null ⇒ 保留（`preservedForCommits`）。这三条对**在飞任务**都正确——`gap-worker-needs-human-destroys-branch-worktree` 正是为「别销毁完成实现」立的。**缺的是任务生命周期终止后的释放**：supersede 是通过 `task_write` 改 status 完成的，不经过 driver 的任何清理路径，`cleanupOrphanWorktree` 也不会被重新触发。

四条相关任务均**已 done 且覆盖别的机制**，本条与它们不重复：
- `gap-worktree-leak-after-fan-in-occupies-slot-permanently` — 已 fan-in 落地却没删（landed 路径）；本条是**从未落地且已不该落地**。
- `gap-worker-driver-restart-orphan-no-outcome-no-timeout` — driver 重启造成的孤儿 worker；本条与 worker 存活无关，7 个都是零活进程。
- `gap-worker-cleanup-judgment-precision` — 让 failed 终态下的清理判据更准；本条是**该路径根本不触发**。
- `gap-worker-driver-cold-start-inflight-blind` — 冷启动在飞排除集；同样只覆盖存活维度。

### 代价的准确范围（⛔ 不夸大）

**残留 worktree 不占 Touches 锁** —— 实测 `computeInFlightWorktreeTouches`（concurrent-batch-scheduler.ts）已有 `INFLIGHT_WORKTREE_STALE_MS = 15min` 活性闸：零活进程 + 末次提交超 15 分钟 ⇒ 不进 in-flight 集。双向对照：活性闸开 ⇒ 占锁 5 个（全是分钟级活跃的），关掉 ⇒ 15 个。所以真实代价是**磁盘单调累积 + `git worktree list` 名单噪声掩埋真正需要注意的条目**，不是派发阻塞。本任务不得以「解除派发阻塞」为理由。

## Plan

1. 在 `worker-driver.ts` 添加 `reclaimSupersededWorktrees(root, opts)`：枚举 `task/<id>` worktree（复用既有 `enumerateTaskWorktreeTasksAsync`），对每个 id 用 `readTaskStatus`（driver-filters.ts:82）读盘上 status；仅 `superseded` 进候选。`opts` 提供 `workerCmdlines` / `worktreeTasks` / `statusOf` 三个测试缝（与 `cleanupOrphanWorktree` 同款）。
2. 回收前双闸，与既有清理路径同构：① `hasLiveWorkerForTask` 命中 ⇒ `skippedLiveWorker`（⛔ 不清）；② `/proc` 下 cwd 在该 worktree 内的任意活进程 ⇒ 同样跳过。
3. 回收动作按机件顺序（⛔ 不手搓）：先 `worktree-process-reaper.ts --worktree <path>` 收探针/挂死 runner（`gap-worktree-remove-orphans-probes` 已建的正确入口），再 `git worktree remove --force <path>`。
4. **分支一律保留**（⛔ 不 `git branch -D`）：superseded 的实现偶有被后继「取用」的先例（本条实证表里 gap-execution-loop 的 ff-merge.ts 正是这么被搬走的），删分支会让这条路径永久断掉；回收的是磁盘，不是历史。
5. 读不懂给独立取值（硬规则 3b）：任务文件缺失 / status 解析不出 ⇒ `status: "unreadable"`，**不与「可回收」也不与「已跳过」同形**，且一律不清。
6. 接进常驻循环的 reconcile 步（`worker-driver.ts` 的 `step = "reconcile"` 分支），每轮跑一次；结果计入该轮的 driver 轮次记录，含候选数为 0 的情形。
7. 测试落 `plugin/test/worker-driver.test.mjs`（纯函数与双闸）与 `plugin/test/worker-driver-resident.test.mjs`（reconcile 步接线）。

## Acceptance Criteria

- [x] AC1（能取假）：`reclaimSupersededWorktrees` 对一个 `status: superseded`、零活进程的 task worktree 返回 `reclaimed: true` 且实际调用了 `git worktree remove --force`；若它保留则该 AC 假。
- [x] AC2（负控制，能取假）：对 `status: ready` 且 worker-outcome 为 `exited-not-landed` 的残留 worktree 返回跳过且**不移除**——保护待续做的实现（2026-09-08 现场有 3 个这样的：perfile-failure-rate-baseline / dead-set-closure / task-branch-prefix，误删即永久丢失分支上的实现）；若移除则该 AC 假。
- [x] AC3（负控制，能取假）：注入一条命中该 task 的 `workerCmdlines` ⇒ 返回 `skippedLiveWorker: true` 且不移除；同一输入去掉该 cmdline ⇒ 转为可回收（同一函数两次调用给出相反结果，证明该闸真在判而非恒真）。
- [x] AC4（能取假）：移除前调用了 `worktree-process-reaper.ts --worktree <path>`（断言调用序：reaper 先于 remove），且移除后 `git rev-parse --verify task/<id>` 仍 exit 0——**分支保留**；分支被删则该 AC 假。
- [x] AC5（硬规则 3b，能取假）：任务文件缺失或 status 读不懂 ⇒ 返回值里出现独立取值 `"unreadable"`，且该取值 `!== ` 可回收取值、`!== ` 跳过取值（断言三者两两不等），并且不移除。
- [x] AC6（接线，非「函数存在」）：`plugin/test/worker-driver-resident.test.mjs` 断言常驻循环 reconcile 步实际调用了本函数（注入缝计数 ≥1）；仅导出函数而 reconcile 步不调 ⇒ 该 AC 假。
- [x] AC7（读生产载体，硬规则 4 推论三）：实现落地后跑至少一轮真实 driver，该轮的 driver 轮次记录中含本步的结果字段（候选数为 0 时记 0，⛔ 不省略）——使「跑过且无候选」与「压根没跑」在载体上可区分；关掉注入缝后该 AC 仍能通过（否则它只是回声）。

## Definition of Done

- [x] `reclaimSupersededWorktrees` 落地并接进常驻循环 reconcile 步，AC1–AC7 全勾，`bash scripts/test.sh --for-task gap-superseded-task-residual-worktree-never-reclaimed --allow-thin` 绿，经 fan-in ff 到 develop。
- [ ] 真实运行验证（非 fixture）：实现落地后，构造或等待一个 status 翻 superseded 且带残留 worktree 的真实任务，driver 下一轮自动回收它，`git worktree list` 中该条目消失而 `task/<id>` 分支仍在——盘上对象真的被机制操作过一次，不是「测试通过」。（待外部）
- [ ] 2026-09-08 手工清理的 7 个不重现：此后 superseded 残留由机制回收，人不再需要手跑清理脚本。（待外部）

## Touches

- plugin/scripts/worker-driver.ts（添加 reclaimSupersededWorktrees() 及其在常驻循环 reconcile 步的调用点）
- plugin/test/worker-driver.test.mjs（纯函数 + 双闸 + unreadable 独立取值的测试）
- plugin/test/worker-driver-resident.test.mjs（reconcile 步接线断言）
- docs/analysis/quay-init-closure-ratchet.baseline.json（worker-driver.ts 是 quay-init laydown 源，增长需 re-anchor 该 closure baseline）
- tasks/gap-superseded-task-residual-worktree-never-reclaimed.md（自身）
