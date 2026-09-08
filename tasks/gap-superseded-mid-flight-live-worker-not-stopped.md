---
id: gap-superseded-mid-flight-live-worker-not-stopped
title: status 翻 superseded 时活 worker 无路径被终止——reclaimSupersededWorktrees 只记
  skippedLiveWorker，从不发信号
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

**一个任务在 worker 已在飞期间被撤回为 `status: superseded` 时，没有任何路径终止那个 worker——它会继续实现一个已知为假前提的方案，直到自己耗尽/被人工 kill。** `reclaimSupersededWorktrees`（`plugin/scripts/worker-driver.ts:818`）每轮 reconcile 都正确识别出这个状态（双闸设计，`:858-860`：`hasLiveWorkerForTask` 命中 ⇒ `skippedLiveWorker: true`），但双闸之后只是**跳过**，从不对那个活 worker 发任何终止信号——这是有意设计（保护可能仍在做有效工作的活 worker，见 `gap-superseded-task-residual-worktree-never-reclaimed` AC3），但对 `status: superseded` 这一个特定终态而言，「继续实现」在定义上就不存在有效工作可保护。

### 实证（2026-09-08，今日实时复现，非推断）

`gap-carrierstats-stalesecs-uniform-on-event-driven-carriers`：

```
16:14:57Z  promotion-driver 机械晋升 todo→ready
16:23:30Z  worker-driver 派发 worker（session dffac1bd-c2de-4f81-bdf9-c8448fcbe478, pid 2456242）
16:24:52Z  task_write 撤回为 status: superseded（作者发现前提为假，正文写明「⛔ 不要实现」）
16:30:48Z  round 78：superseded_reclaim 命中该任务，skippedLiveWorker:true, reclaimed:false
16:32:05Z  round 79：同上；同一时刻 worker 会话仍在 Edit driver-runtime.ts 实现原方案（cadence 字段等）
16:33:41Z  round 80：同上，第三次命中仍只跳过
16:34:xx   人工 kill -TERM 2456242（本任务的发现者，见 tasks/gap-carrierstats-stalesecs-uniform-on-event-driven-carriers.md 撤回记录）
16:36:26Z  worker-dispatch.json 记录该轮 outcome：exit_code:143, final_state:"failed",
           worktree_cleanup_sigterm_external:true, worktree_cleanup_has_commits:false
```

`.quay/worker-round.jsonl` 三轮（78/79/80）的 `superseded_reclaim.perTask[]` 逐条确认：机制**每轮都看见**这个状态，**从未采取行动**，直到外部人工介入。worker 会话自己的 transcript（`query_session_content(session_id=dffac1bd-...)`）确认 16:32:04Z 仍在对撤回前提做 Edit——它对撤回毫不知情（dispatch prompt 是一次性快照，worker 不会中途重读任务状态）。

**代价**：本例浪费约 13 分钟活 worker 计算（16:23→16:36）+ 占用一个 in-flight 名额（`in_flight_task_starts` 全程带着它）。人工 kill 后机制自身的清理路径（`worktree_cleaned:true`，无提交故无需保留分支）正确吸收了这次终止——证明「发信号后交给现有清理路径」这条链路本身没问题，缺的只是发信号这一步。

### 为什么现有机制够不着（逐条排除）

- `reclaimSupersededWorktrees` 的双闸是为**磁盘回收**设计的（回收 worktree/分支），其「遇活 worker 就跳过」对磁盘回收场景是对的——不能在 worker 还在写文件时 `git worktree remove`。但它把「不回收磁盘」和「不终止进程」绑成了同一个跳过动作，而这两者本该分开判断。
- `gap-superseded-task-residual-worktree-never-reclaimed`（已 done）的 AC2/AC3 明确要求**保护**活 worker 不被磁盘回收误删——这是对的，但该任务的 Proposal 通篇讨论的是**已死 worker 的残留 worktree**，从未涉及**活 worker 该不该被终止**这个正交问题。
- `gap-live-ghost-superseded-task-workflow-events-start`（已 done）只修 `/live` 页渲染，不涉及任何进程动作。

## Plan

1. 在 `reclaimSupersededWorktrees`（`worker-driver.ts:818`）内，双闸判定为 `skippedLiveWorker: true` 且任务 `status === 'superseded'`（**不含 `needs-human`**——该状态下活 worker 可能正合法地做完手头步骤再升级，语义不如 superseded 干净，本任务不动它）的分支，追加：用已算出的 cmdline 匹配解出对应 pid，调用可注入的 `sendSignal(pid, 'SIGTERM')`（默认 `process.kill`），并在结果对象新增独立字段 `liveWorkerSignaled: boolean` 记录是否真的发了信号——不与 `skippedLiveWorker` 共用同一个布尔（硬规则 3b：跳过未信号 vs 跳过已信号必须可区分）。
2. 信号发出后**不**在本轮内做磁盘回收（worker 进程退出是异步的）——下一轮 reconcile 时 `hasLiveWorkerForTask` 应已判 false，`reclaimSupersededWorktrees`/`cleanupOrphanWorktree` 走既有回收路径即可，本任务只负责补上「发信号」这一步，不新建回收逻辑。
3. 测试缝：复用 `reclaimSupersededWorktrees` 已有的 `workerCmdlines`/`worktreeTasks`/`statusOf` 注入参数，新增 `sendSignal` 注入参数（签名 `(pid: number, signal: string) => void`）。
4. 接进常驻循环 reconcile 步（调用点约 `worker-driver.ts:4293`）——复用现有接线，无需新增调用位置。

## Acceptance Criteria

- [x] AC1（能取假，直接信号）：对一个 `status: superseded` 且 `hasLiveWorkerForTask` 命中的任务，`reclaimSupersededWorktrees` 在本轮调用了注入的 `sendSignal(pid, 'SIGTERM')`（断言调用参数含正确 pid）；不改代码直接跑则该 AC 假（当前行为是仅 skip）。
- [x] AC2（负控制，能取假，needs-human 不变）：同一双闸逻辑对 `status: needs-human` 且命中活 worker 的任务**不**调用 `sendSignal`（保持现状 skip-only）；若调用则该 AC 假。
- [x] AC3（负控制，能取假，非终态不动）：对 `status: ready`（非终态、根本不在候选集）的任务，`sendSignal` 不被调用；若调用则该 AC 假。
- [x] AC4（硬规则 3b，能取假，取值可区分）：结果对象新增 `liveWorkerSignaled` 字段，注入「已发信号」与「未发信号（needs-human 分支）」两种场景，断言两次返回的该字段值不同（同一字段两次取不同值，证明它真在判而非恒定）。
- [x] AC5（接线，非函数存在，能取假）：`plugin/test/worker-driver-resident.test.mjs` 断言常驻循环 reconcile 步真实调用到本次改动（注入缝计数 ≥1）；仅改导出函数而 reconcile 步未接线则该 AC 假。
- [x] AC6（硬规则 4 推论三，读生产载体，能取假）：实现落地后跑至少一轮真实 driver，`.quay/worker-round.jsonl` 该轮 `superseded_reclaim.perTask[]` 对应条目携带 `liveWorkerSignaled` 字段（候选数为 0 时也记录该轮结构存在该字段，⛔ 不省略）；关掉注入缝（用默认 `process.kill`）后该 AC 仍能通过——否则它只是回声。

## Definition of Done

`reclaimSupersededWorktrees` 对 `status: superseded` 且命中活 worker 的任务发送 SIGTERM 而非仅记录跳过；AC1–AC6 全勾；`bash scripts/test.sh --for-task gap-superseded-mid-flight-live-worker-not-stopped --allow-thin` 绿，经 fan-in ff 到 develop。
- [ ] 真实运行验证（非 fixture）：此后再发生一次「任务在飞期间被撤回为 superseded」，driver 下一轮自动终止其 worker，不再需要人工 `kill -TERM`——本任务立案当天的 gap-carrierstats-stalesecs-uniform-on-event-driven-carriers（人工 kill pid 2456242）是这个待验证场景的前例，不算生产验证。（待外部）

## Touches

- plugin/scripts/worker-driver.ts（reclaimSupersededWorktrees 新增 sendSignal 调用 + liveWorkerSignaled 字段 + 结果类型）
- plugin/test/worker-driver.test.mjs（AC1-AC4：信号注入缝 + 双闸负控制 + 字段可区分性测试）
- plugin/test/worker-driver-resident.test.mjs（AC5：reconcile 步接线断言）
- tasks/gap-superseded-mid-flight-live-worker-not-stopped.md（自身）
