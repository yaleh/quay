---
id: gap-continue-cycle-misses-ff-not-fast-forward-redispatch
title: continue-cycle 漏 ff-not-fast-forward 续做识别——RECOMMENDED 的 ff-failed 任务 2h 不重派
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

`gap-retire-governance-group-merge-into-bucket` 现 slot-refill **RECOMMENDED**（非 deferred、非 backoff-持有），但 last outcome 13:33 step=ff「FF FAILED — not a fast-forward」后 **~2h 不重派**。CONTINUE note（continueConflictResolutionNote）已教 ff-not-fast-forward 的消解（merge develop 再 ff 再 exit），但 driver 的 continue-cycle **未把 ff-failed 任务识别为续做状态** → 静置 RECOMMENDED 不派。

**根因方向**（需 inner 核）：continue-cycle 的 exited-not-landed 续做识别只覆盖部分 step（如 merge-develop 冲突 / suite red），未覆盖 `step=ff: not a fast-forward`——该 step 的 worker 退出被记为 exited-not-landed，但续做判定漏了它，任务回到 ready 池却不再被派。

## Plan

核 `worker-driver.ts` continue-cycle 的 exited-not-landed 识别清单，确认 `step=ff: not a fast-forward` 是否在续做触发集内；若漏，补上（ff-failed → CONTINUE 重派，merge develop 再 ff）。

**实现注记（inner 核后更正根因）**：续做识别（`continueStateForTask` 按残留 worktree）与续做 prompt（`continueConflictResolutionNote` 无条件含 FF NOT FAST-FORWARD 消解）**本就覆盖** ff-failed——并无 step-based 清单漏项。真正缺口在**重试上限**：`runResidentLoop` 把 ff-not-fast-forward 的 exited-not-landed 与真缺陷同形 `advanceRetryCap` 计数，3 次（含 2 次分支滞后）撞 cap ⇒ 误标 needs-human ⇒ 静置不派（2026-08-30 实况 `gap-retire-governance-group-merge-into-bucket`，人手动翻 needs-human→ready 才恢复）。修法：`isFfNotFastForwardFailure`（`mechanical_fan_in.step==="ff"` ∧ reason 含 `not a fast-forward`）判 transient，该失败**不计**重试上限 ⇒ ff-failed 继续 CONTINUE 重派自愈；真缺陷（suite red / merge-develop 冲突 / anti-drift 违反 / ff 步的 post-check·防活锁 escalation）照常计上限。

## Acceptance Criteria

- [x] AC1（能取假）：ff-not-fast-forward 失败的任务被 continue-cycle 重派（RECOMMENDED 后不再静置，worker 收到 merge develop 再 ff 的续做 prompt）；（⛔ 仍静置 RECOMMENDED 不派 ⇒ 假）。
- [x] AC2（能取假，单测）：worker-driver.test.mjs 断言「step=ff: not a fast-forward 的 exited-not-landed 记录触发续做识别」，改掉任一 ⇒ 红。

## Definition of Done

continue-cycle 覆盖 ff-not-fast-forward 续做识别；AC1-AC2 全勾；全量 suite 绿；ff-failed 任务不再静置。

## Touches

- plugin/scripts/worker-driver.ts（continue-cycle 续做识别补 ff-not-fast-forward）
- plugin/test/worker-driver.test.mjs（AC2 单测）
- tasks/gap-continue-cycle-misses-ff-not-fast-forward-redispatch.md（自身）
