---
id: gap-task-status-event-create-lacks-title-and-goal-ac
title: v1 create 事件不带 title / goal_ac，外部消费者收到新任务事件后仍只能再读一次全量
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

v1 状态事件在创建时写 `from:null, kind:"create"`（`packages/quay-native/src/store.ts` 的 `emitAbiStatusEvent`），但记录里只有 `taskId`，没有 `title`，也没有 `goal_ac`。

外部只读消费者（claudecodeui 的会话 popover）的读法是「一次 `quay task list --json --no-body` 做底 + `quay task log --json --since <cursor>` 增量」。一条 create 事件到达时，消费者无法把新任务的标题/所属 AC 填进本地索引，只能再发一次全量读或逐条 `task view`。

同时确认本任务的**负边界**（⛔ 不是缺陷）：标题/标签/正文变更**不**发事件是有意设计——`store.ts` 的注释写明「Only a real transition emits: a creation or a status change. A body-only edit, a label write: no event」。本任务不改变这条语义，也不新增事件 kind。

## AC

- [ ] AC1：`kind:"create"` 的 v1 事件在调用方给出 title/goal_ac 时携带可选字段 `title` 与 `goal_ac`；创建时没有 goal_ac ⇒ **不写该键**（⛔ 不写 `null` 或空串冒充）。贴一条真实 create 事件的完整 JSON。
- [ ] AC2（向后兼容）：不带这两个新字段的旧 v1 行仍被 `quay task log --json` 原样读出（`title` 是**缺键**而不是空串），贴一条旧 fixture 行的读出结果。
- [ ] AC3（非目标负控制）：一次只改 title（status 不变）的 write **仍不产生**任何事件；贴写入前后的 `quay task log --since <cursor>` 输出均无新行。
- [ ] AC4（契约登记）：`packages/quay/src/cli/help.ts` 的事件契约段写明这两个字段是 create-only、可选、v1-compatible；⛔ 不改 `schema` 版本号。

## DoD

- 改动落在 `packages/quay-native/src/store.ts` 的 emit 路径与 `packages/quay/src/kernel/task-transition.ts` 的记录类型；`task log --json` 的转出同步。
- 有 `node:test` 覆盖 AC1/AC2/AC3；⛔ 不新增事件 kind，不改 `from/to` 语义。
- 一次真实写入产生的 carrier 行（不是 fixture）被贴进任务证据。

## Touches

- `tasks/gap-task-status-event-create-lacks-title-and-goal-ac.md`（自指）
- `packages/quay-native/src/store.ts`（create 事件字段）
- `packages/quay/src/kernel/task-transition.ts`（记录类型与转出）
- `packages/quay/src/cli/task-log.ts`（转出同步）
- `packages/quay/src/cli/help.ts`（事件契约段）
- `packages/quay/test/task-log.test.mjs`