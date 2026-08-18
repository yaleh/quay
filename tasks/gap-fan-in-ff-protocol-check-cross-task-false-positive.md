---
id: gap-fan-in-ff-protocol-check-cross-task-false-positive
title: "fan-in-ff-protocol-check 跨任务误报——checker 未按 taskId 作用域，4-way 并发 fan-in 下报别任务 ff 违规"
status: ready
labels:
  - gap
  - mechanism
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

- [ ] AC1: `fan-in-ff-protocol-check` 按 taskId 作用域隔离——只报本任务 ff 违规，不跨任务误报。
- [ ] AC2: 负控制——多任务并发 fan-in 时，checker 对每个任务只报其自身 ff 违规（交叉场景零误报）。
- [ ] AC3: 该 checker 误报不再被 suite-fix 当本任务红越界修（配合 `gap-suite-fix-workflow-no-load-sensitive-branch` 的 fix-scope gate）。

## Definition of Done

- [ ] 多任务并发 fan-in 时 `fan-in-ff-protocol-check` 只报本任务（真实输出，非 fixture），交叉误报归零。

## Touches

- tasks/gap-fan-in-ff-protocol-check-cross-task-false-positive.md（自身）
- plugin/scripts/fan-in-ff-protocol-check.ts（taskId 作用域隔离）
- plugin/test/fan-in-ff-protocol-check.test.mjs（跨任务误报负控制）
