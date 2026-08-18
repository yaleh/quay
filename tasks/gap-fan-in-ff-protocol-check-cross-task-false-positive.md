---
id: gap-fan-in-ff-protocol-check-cross-task-false-positive
title: "fan-in-ff-protocol-check 跨任务误报——checker 未按 taskId 作用域，4-way 并发 fan-in 下报别任务 ff 违规"
status: done
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`fan-in-ff-protocol-check` 在 4-way 并发 fan-in 下**跨任务误报**——checker 未按 taskId 作用域隔离，把别任务的 ff 违规报成本任务的。suite-fix agent 把它当本任务红、越界修 checker（`3c20f5ed`「按 taskId 作用域」改 `fan-in-ff-protocol-check.ts` + 其 test，均不在 full-suite-state-stale 的 Touches）→ anti-drift HARD FAIL → needs-human。

**性质**：这是 checker 自身的 taskId 作用域 bug（非 load-sensitive 族、非本任务回归），应独立修。误报本身很可能被 4-way 并发 fan-in 放大（多任务 ff 同时跑、checker 交叉读）——slot 缺陷（`gap-suite-slot-lock-not-enforcing-concurrency`）land 降并发后大概率缓解，但 checker 的 taskId 作用域 bug 仍该独立修，不塞进任何 fan-in 任务。

## Acceptance Criteria

- [x] AC1: `fan-in-ff-protocol-check` 按 taskId 作用域隔离——只报本任务 ff 违规，不跨任务误报。
- [x] AC2: 负控制——多任务并发 fan-in 时，checker 对每个任务只报其自身 ff 违规（交叉场景零误报）。
- [ ] AC3: 该 checker 误报不再被 suite-fix 当本任务红越界修（配合 `gap-suite-fix-workflow-no-load-sensitive-branch` 的 fix-scope gate）。—— 根因（跨任务误报）已消除（AC1/AC2 负控制：跨任务重叠 PASS），「不再被越界修」为 fan-in-time 下游观察（待外部）

## Definition of Done

- [ ] 多任务并发 fan-in 时 `fan-in-ff-protocol-check` 只报本任务（真实输出，非 fixture），交叉误报归零。—— 需真实多任务并发 fan-in 窗口观察交叉误报归零（待外部）

## Evidence

- **scoped gate**: `bash scripts/test.sh --for-task gap-fan-in-ff-protocol-check-cross-task-false-positive` → **exit 0**；`plugin/test/fan-in-ff-protocol-check.test.mjs` **18/18 pass**（含新增负控制「PURE checkSuiteInLock — cross-task overlap is NOT a violation; same-task overlap is」+「判据2b cross-task negative control — a DIFFERENT task's lock-hold overlapping the suite run ⇒ PASS」）。
- **真实输出（主检出，非 fixture）**: `node --no-warnings --experimental-strip-types plugin/scripts/fan-in-ff-protocol-check.ts --root /home/yale/work/quay --baseline 19fea6f0 --json` → `{evaluated:true, ok:true, reason:"pass"}`；`suite-in-lock` 子检查 `evaluated:true, ok:true, overlaps:[]`（读主检出真实锁事件 + 真实 suite 态，跨任务锁不再误报）。
- **下游消费方回归**: `direct-to-develop-bypass-check.test.mjs` **30/30 pass**（其 import `buildLockHoldIntervals`；interval 新增 `taskId` 字段为增量、无破坏）。

**修法**（对齐越界提交 `3c20f5ed` 的 canonical shape，落于本任务 Touches）：
- `buildLockHoldIntervals` interval 透传 `taskId`（`{start,end,key,taskId}`）；
- `suiteRunInterval` 返回 `{start,end,taskId}`（读 suite 态 `taskId` 字段，缺则 null）；
- `checkSuiteInLock` 当 suite 态带 taskId 时只判【同任务】锁 hold 为违规，无 taskId（legacy / outer 全量轮）回退无作用域时间重叠。

## Touches

- tasks/gap-fan-in-ff-protocol-check-cross-task-false-positive.md（自身）
- plugin/scripts/fan-in-ff-protocol-check.ts（taskId 作用域隔离）
- plugin/test/fan-in-ff-protocol-check.test.mjs（跨任务误报负控制）
