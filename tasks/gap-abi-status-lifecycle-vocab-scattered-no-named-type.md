---
id: gap-abi-status-lifecycle-vocab-scattered-no-named-type
title: 任务状态生命周期词汇散落 ~30 文件、无具名 TaskStatus 类型（Task.status 内联 union 未导出 +
  AdrRecord.status 裸 string）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

生命周期词汇（`todo/ready/done/needs-human/superseded`）在 `packages/*/src/` + `plugin/scripts/` 里作为裸 string 字面量散落 ~30 文件（`"done"` 30 / `"needs-human"` 17 / `"todo"` 16 / `"ready"` 17，实测），没有单一来源、没有可 import 的具名类型。消费者对状态的判读全靠字符串比较（`status === "done"`），词汇若增删一处，只能 grep 散落的全部字面量。

**⚠️ 精确化（manager 原报「abi.ts:21 status: string」是对行号的误指）**：`packages/quay/src/abi.ts` 实况——
- `Task.status`（`:9`）**已是内联 union** `'todo' | 'ready' | 'done' | 'needs-human' | 'superseded'`（不是裸 string）；
- `AdrRecord.status`（`:21`）才是裸 `string`（但那是 ADR 生命周期，与本任务状态无关）。

⇒ 真正缺口不是「status 是裸 string」（Task 不是），而是：**① union 内联未具名未导出**，消费者无法 import 一个 `TaskStatus` 类型去给自己的变量/解析结果标注；**② 生命周期字面量无单一来源**，散落 ~30 文件的字符串比较无编译期保证。**③ 解析边界丢类型**：从 YAML/JSON 盘读 status 的地方得的是 `string`（不是 union），比较 `=== "done"` 时类型系统不参与——这才是「body 历史行伪装 status」「非法值静默漏过」这类 bug 类（记忆 `task-status-read-from-frontmatter-not-grep` 记的 10 分钟 2 犯）能存活的结构条件。

## Plan

- 具名 `TaskStatus` 类型：`abi.ts` 导出 `export type TaskStatus = Task['status']`（或显式 union），消费者 import 标注；
- 单一字面量来源：一个 `TASK_STATUSES` const（数组/对象）+ 类型守卫 `isTaskStatus(s): s is TaskStatus`，散落消费者改为引用它或按类型判读；
- 解析边界收口：盘读 status 的地方（parseTask / 各 provider 的 YAML/JSON 解析）用 `isTaskStatus` 守卫，非法值 fail-closed（硬规则 3b：读不懂 ≠ 合格）而非静默当 string。

## Acceptance Criteria

- [ ] AC1（能取假，具名类型）：`abi.ts` 导出具名 `TaskStatus` 类型，≥1 个消费者 import 它标注自己的 status 变量/解析结果（grep 到 import）；（⛔ 仍只有内联 union 无导出 ⇒ 假）。
- [ ] AC2（能取假，字面量收敛）：生命周期字面量（`"done"`/`"needs-human"`/`"todo"`/`"ready"`/`"superseded"`）散落的文件数从 ~30 降到 ≤3（单一来源 + 少量 typed 消费者），grep 计数；（⛔ 仍 ~30 文件散落 ⇒ 假）。
- [ ] AC3（能取假，解析边界守卫）：盘读 status 的路径用 `isTaskStatus` 守卫，喂一个非法值（如 `"reddy"`）⇒ fail-closed（拒/报错），不静默当 string 通过；（⛔ 静默通过 ⇒ 假）。

## Definition of Done

`TaskStatus` 具名类型 + `TASK_STATUSES` 单一来源落地；散落文件数 grep 收敛；解析边界守卫非法值 fail-closed；AC1/AC2/AC3 全勾；`provider-abi-conformance.test.mjs` 绿（ABI 契约不回归）。

## Touches

- packages/quay/src/abi.ts（导出 TaskStatus + TASK_STATUSES 单一来源 + isTaskStatus 守卫）
- packages/quay/src/gate/lifecycle.ts（消费者迁移）
- packages/quay/src/gate/driver.ts（消费者迁移）
- packages/quay/src/goal-store.ts（消费者迁移）
- packages/quay/src/observation.ts（消费者迁移）
- packages/quay/src/serve-dashboard.ts（消费者迁移）
- packages/quay-native/src/store.ts（YAML 盘读解析点，isTaskStatus 守卫）
- packages/quay-github/src/github-client.ts（消费者迁移）
- plugin/scripts/task-schema.ts（parseTask 盘读解析点，isTaskStatus 守卫）
- plugin/scripts/cap-counts-subagents-check.ts（消费者迁移）
- plugin/scripts/portfolio-choice.ts（消费者迁移）
- plugin/scripts/prod-data-audit.ts（消费者迁移）
- plugin/scripts/ready-pool-check.ts（消费者迁移）
- plugin/scripts/suite-driver.ts（消费者迁移）
- plugin/scripts/task-status-drift-check.ts（消费者迁移）
- plugin/scripts/worker-driver.ts（消费者迁移）
- plugin/scripts/workflow-baseline-metrics.ts（消费者迁移）
- plugin/scripts/workflow-replay.ts（消费者迁移）
- plugin/test/abi-task-status-typing.test.mjs (new)（类型守卫 + 非法值 fail-closed 负控制）
- tasks/gap-abi-status-lifecycle-vocab-scattered-no-named-type.md（自身）

## Needs-Human

**执行 2026-08-28T20:23:53.355Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
