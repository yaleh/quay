---
id: gap-fan-in-workflow-lock-stale-runid-detached-holder
title: fan-in workflow 锁事件记陈旧 runId（detached holder 跨调用存活 + pidfile 不记 runId +
  守卫不比对）→ readWorkflowLockHold 读空、lock_hold 判据 null
status: ready
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

fan-in workflow 锁的 acquire/release 事件会记录【陈旧 runId】（上一次派发的孤儿持有者留下的），而非本次派发的 runId ⇒ `readWorkflowLockHold` 按正确 runId 匹配读空、lock_hold 时长判据 null。

**根因（三点，逐行核实）**：
1. `fan-in-ff-merge.sh` pidfile 路径按 task 分（`/tmp/fan-in-workflow-lock-${task_id}.pid`），内容只写 PID，不记 runId。
2. 幂等守卫（:219）只查 `-s pidfile && kill -0 $(cat pidfile)`（同 task 有没有活 holder），完全不比对 runId。
3. detached holder（:241 `setsid bash -c '... flock -x ...' & disown`）跨调用存活——调用方超时/被杀只杀前台 acquire 脚本，不杀脱离的 holder；它继续在 flock 队列等，拿到锁后按自己被 spawn 时带的 runId 写事件。

**实证（生产已发生一次）**：gap-bucket-second-truth-source-page-recompute 第一次派发（runId wk-prod-1787834794）机械 fan-in acquire 被 120s 杀前台，detached holder 存活排队 ~27min，16:00:40 拿到锁写事件带旧 runId。第二次派发（fresh runId）acquire 撞守卫复用旧 holder ⇒ 锁事件仍旧 runId。第二派发 completed、fix 进 develop——正确性不受影响（flock+flag 按 task 派生），只有会计错。

**影响**：`worker-driver.ts readWorkflowLockHold(root, task, runId)` 按 taskId+runId 匹配锁事件，正确 runId 读空 ⇒ lockHoldSecs/lockAcquireEpoch null（机械 fan-in AC1/AC2 判据失效）；fan-in 提交 subject 的 runId bridge 与锁事件对不上，telemetry join 断。

## Plan

修法 (a)（已核实可行性）：pidfile 记 runId（`$$ <runId>`）+ 守卫比对，不匹配 = 陈旧 holder；用 acquired marker 分叉：
- 无 `workflow_lock_acquired` marker = 还在 flock 排队（没做过活）→ `kill $(cat pidfile)` + rm 三标记 + 重新 spawn（本次 runId）。
- 有 marker = 已持锁（可能 merge/suite/ff 中）→ 不动，让路/watchdog。
⛔ 清理排队 holder 必须 kill 而非 rm flag（它卡在 flock 不在 hold-loop）。acquired marker 只在 flock 成功后 touch（:234）、只在 release rm（:240），是可靠的「排队 vs 已持锁」信号。

## Acceptance Criteria

- [ ] AC1（能取假，会计正确）：锁事件的 runId == 本次派发的 runId（⛔ 仍陈旧 runId ⇒ 假）。
- [ ] AC2（能取假，判据读到）：readWorkflowLockHold(task, runId) 按正确 runId 读到 lockHoldSecs/lockAcquireEpoch（⛔ null ⇒ 假——机械 AC1/AC2 判据失效）。
- [ ] AC3（能取假，陈旧 holder 清理）：runId 不匹配且无 acquired marker 的排队 holder 被 kill + 重新 spawn（⛔ 复用陈旧 holder ⇒ 假）。

## Definition of Done

pidfile 记 runId + 守卫比对 + 陈旧排队 holder 清理；AC1-AC3 全勾；锁事件 runId 与派发 runId 一致；readWorkflowLockHold 读到 lock_hold 判据。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（acquire/guard/pidfile 块：pidfile 记 runId + 守卫比对 + 陈旧 holder kill）
- plugin/test/fan-in-ff-merge.test.mjs（runId 比对 + 陈旧 holder 清理测试）
- plugin/test/fan-in-workflow-lock.test.mjs（锁事件 runId 正确性）
- plugin/scripts/worker-driver.ts（readWorkflowLockHold 若需同步）
- tasks/gap-fan-in-workflow-lock-stale-runid-detached-holder.md（自身）
