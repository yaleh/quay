---
id: gap-goal031-needs-human-literal-migration
title: GOAL-031 ①：goal-driver.ts 5 处 needs-human 裸字面量迁移到 task-status.ts 正本
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-343
---
**type:** execution

## Proposal

GOAL-031 的第一块：把 `plugin/scripts/goal-driver.ts` 里 5 处真实的 `task.status === "needs-human"` 裸字面量比较迁移为消费 `plugin/scripts/task-status.ts` 的既有正本（`TASK_STATUS.NEEDS_HUMAN` 或 `isTaskStatus`），不新造第二套声明。

**执行前已核实的精确范围**（位置判定，非关键词；见 GOAL-031 goal body「背景」的完整核实记录）：

目标 5 行（`grep -n 'status === "needs-human"' plugin/scripts/goal-driver.ts` 当前命中，逐一确认为真实 task.status 比较，不是其它词表）：
- `goal-driver.ts:2088` — `if (task.status === "needs-human") return true;`（函数 `isTaskStuck`）
- `goal-driver.ts:2098` — `return status === "todo" || status === "ready" || status === "needs-human";`（函数 `isTractionStatus`；**只替换 needs-human 这一项，todo/ready 保持裸字面量不变**——用户显式约束，即使同行风格不一致也接受）
- `goal-driver.ts:2319` — `} else if (inFlight.every((t) => t.status === "needs-human")) {`
- `goal-driver.ts:2383` — `} else if (inFlight.every((t) => t.status === "needs-human")) {`
- `goal-driver.ts:2443` — `} else if (traction.every((t) => t.status === "needs-human")) {`

⛔ 必须保持原样、禁止触碰的同类字面量：
- `goal-driver.ts:823` — `(r.status === "active" || r.status === "achieved" || r.status === "needs-human"),`——这是 GOAL-AC 的 `status` 字段（不同词表：active/achieved/needs-human 是 GOAL-AC 状态，不是 task 状态），逐字节不变。
- 任何 `=== "todo"`／`=== "ready"`／`=== "done"` 字面量（除 2098 行内按上述规则处理的那一项外）——保持裸字面量，⛔ 不顺手扫。

## Plan

1. 在 `goal-driver.ts` 顶部新增 `import { TASK_STATUS, isTaskStatus } from "./task-status.ts";`（或按文件现有 import 风格调整，确认相对路径正确——`goal-driver.ts` 与 `task-status.ts` 同在 `plugin/scripts/` 下）。
2. 5 处目标逐一替换为 `=== TASK_STATUS.NEEDS_HUMAN`（或等价的 `isTaskStatus` 用法，按上下文选更自然的一种，两种都可接受，不强制统一写法）。
3. 2098 行只替换 `needs-human` 那一项，`"todo"`/`"ready"` 两项原样保留。
4. 823 行逐字节不动。

## Acceptance Criteria

- [ ] `grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts` 精确等于 1（只剩 823 行）：`[ "$(grep -c 'status === \"needs-human\"' plugin/scripts/goal-driver.ts)" = "1" ]`
- [ ] 823 行逐字节不变：`grep -qF '(r.status === "active" || r.status === "achieved" || r.status === "needs-human"),' plugin/scripts/goal-driver.ts`
- [ ] 新增正本 import：`grep -qE "from [\"'].*task-status(\.ts)?[\"']" plugin/scripts/goal-driver.ts`
- [ ] todo/ready/done 字面量计数不变（2/2/0）：`[ "$(grep -c '=== \"todo\"' plugin/scripts/goal-driver.ts)" = "2" ] && [ "$(grep -c '=== \"ready\"' plugin/scripts/goal-driver.ts)" = "2" ] && [ "$(grep -c '=== \"done\"' plugin/scripts/goal-driver.ts)" = "0" ]`
- [ ] 不依赖 goal/GOAL-030 专属产物：`! grep -qE "kernel/task-transition|branch-selfhost-probe" plugin/scripts/goal-driver.ts`
- [ ] 相关测试分片绿：`goal-driver-s01/s06/s08/s12.test.mjs` 全绿（覆盖 `isTaskStuck`/`isTractionStatus`/`stalled` 路径）
- [ ] `plugin/scripts/import-graph-check.ts --json` 的 `verdict.ok === true`（棘轮不回退）

## Definition of Done

5 处真实的 `needs-human` 裸字面量迁移完成，823 行与所有 todo/ready/done 字面量逐字节不变，`goal-driver.ts` 新增对 `task-status.ts` 的 import，`import-graph-check.ts` 棘轮不回退，相关测试分片绿。本任务落地后即可触发 GOAL-031 的 AC-343（结构与范围护栏）判定为真。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver-s01.test.mjs
- plugin/test/goal-driver-s06.test.mjs
- plugin/test/goal-driver-s08.test.mjs
- plugin/test/goal-driver-s12.test.mjs
- tasks/gap-goal031-needs-human-literal-migration.md
