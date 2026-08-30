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

- [x] AC1（能取假，具名类型）：`abi.ts` 导出具名 `TaskStatus` 类型，≥1 个消费者 import 它标注自己的 status 变量/解析结果（grep 到 import）；（⛔ 仍只有内联 union 无导出 ⇒ 假）。
  - 证据：`packages/quay-native/src/store.ts:12` 与 `packages/quay/src/observation.ts:33` 均 `import type { TaskStatus }`，并标注盘读 status 的解析结果（`const status: TaskStatus | null`、`readTaskStatusOnDisk(): TaskStatus | null`）。`grep -rn "type TaskStatus"`（消费者、排除 abi.ts 定义处）命中 2 处 import。
- [x] AC2（能取假，字面量收敛）：生命周期字面量（`"done"`/`"needs-human"`/`"todo"`/`"ready"`/`"superseded"`）散落的文件数从 ~30 降到 ≤4（单一来源 + 少量 typed 消费者 + 1 独立包例外），grep 计数；（⛔ 仍 ~30 文件散落 ⇒ 假）。
  - 证据：生命周期字面量**每树单一来源**——`packages/quay/src/abi.ts`（packages/* 树）+ `plugin/scripts/task-status.ts`（plugin 树自包含副本；build-plugin-dist 把 plugin/ 打进独立包、静态 `import "../../packages/quay/src/abi.ts"` 打包后不可解析——sync-vendor.sh 同款理由，故 plugin 树不 import Core 源码）。16 个消费者文件已从裸字面量迁到 `TASK_STATUS.*`/`isTaskStatus`（packages/* 从 `abi.ts` import、plugin/scripts 从 `task-status.ts` import）。仍以裸字面量比较**任务 status** 的文件 = 3 个字节镜像脚本（`it0-split-or-commit-check.ts` / `portfolio-choice.ts` / `task-status-drift-check.ts`，与 `experiments/.../scripts/` 字节一致、跨树 import 会破坏镜像故不动）+ `packages/quay-github/src/github-client.ts`（独立 provider 包：跑源非 bundle，隔离副本测试 `withAdversarialCopy` 只拷 quay-github 包 ⇒ value-import `../../quay/src/abi.ts` 会 `ERR_MODULE_NOT_FOUND`，且 QN-072/073 needle 钉住 `status === "done"` 逐字节形状 ⇒ 保持 `import type` + 裸字面量、不迁移）⇒ ≤4。其余 grep 命中为**异词表**：ADR 状态（`adr-store.ts`/`cli/adr.ts`）、goal 状态（`goal-store.ts`/`serve-goal.ts`）、workflow/suite/build 结果（`workflow-*.ts`/`suite-driver.ts`/`build-evidence-*`）、`TaskCandidate.status: string`（`candidate-*`/`coupling-graph.ts`）、bash 关键字（`config-validate.ts`/`dead-code-after-return-check.ts`）、散文/路由（`cli/help.ts`/`serve-render.ts`）。裸 grep 每词文件数已降：done 30→20、needs-human 17→11、todo 16→11、ready 17→11（src+plugin/scripts，不含 test/dist），残量为上述异词表。
- [x] AC3（能取假，解析边界守卫）：盘读 status 的路径用 `isTaskStatus` 守卫，喂一个非法值（如 `"reddy"`）⇒ fail-closed（拒/报错），不静默当 string 通过；（⛔ 静默通过 ⇒ 假）。
  - 证据：3 处盘读边界均已 `isTaskStatus` 守卫——`store.ts` `toViewModel`（YAML）、`observation.ts` `readTaskStatusOnDisk`、`ready-pool-check.ts` `analyzeTasks` `readFrontField`。负控制：盘上 `status: reddy` ⇒ `store.get` 返回 `status:"todo"` 且 `extra.malformed` 含 `invalid-status`；`isTaskStatus("reddy") === false`。测试 `plugin/test/abi-task-status-typing.test.mjs` 5/5 绿。（`github-client.ts` 的非法 `status:*` 标签由 `checkGate` 的 `gate:"unknown"` fallback 报 `unrecognized status <值>` fail-closed，不走 `isTaskStatus` 守卫——隔离副本 + needle 约束见 AC2 证据。）

## Definition of Done

`TaskStatus` 具名类型 + `TASK_STATUSES` 单一来源落地；散落文件数 grep 收敛；解析边界守卫非法值 fail-closed；AC1/AC2/AC3 全勾；`provider-abi-conformance.test.mjs` 绿（ABI 契约不回归）。

## Touches

- packages/quay/src/abi.ts（导出 TaskStatus + TASK_STATUSES 单一来源 + isTaskStatus 守卫）
- packages/quay/src/gate/lifecycle.ts（消费者迁移）
- packages/quay/src/gate/driver.ts（消费者迁移）
- packages/quay/src/observation.ts（消费者迁移）
- packages/quay/src/serve-dashboard.ts（消费者迁移）
- packages/quay/src/serve-task.ts（消费者迁移）
- packages/quay/src/serve-needs-human.ts（消费者迁移）
- packages/quay-native/src/store.ts（YAML 盘读解析点，isTaskStatus 守卫）
- plugin/scripts/task-status.ts (new)（plugin 树自包含单一来源：TaskStatus + TASK_STATUS + isTaskStatus；不 import packages/quay/src，独立打包可解析）
- plugin/scripts/cap-counts-subagents-check.ts（消费者迁移）
- plugin/scripts/driver-filters.ts（消费者迁移）
- plugin/scripts/needs-human-recheck.ts（消费者迁移）
- plugin/scripts/prod-data-audit.ts（消费者迁移）
- plugin/scripts/ready-pool-check.ts（消费者迁移 + 盘读 status isTaskStatus 守卫）
- plugin/scripts/stale-ready-audit.ts（消费者迁移）
- plugin/scripts/task-ac-carryover-check.ts（消费者迁移）
- plugin/scripts/task-contract-check.ts（消费者迁移）
- plugin/scripts/worker-driver.ts（消费者迁移）
- plugin/scripts/capability-catalog.sh（task-status.ts 六表注册）
- plugin/scripts/quay-init.sh（task-status.ts laydown 显式清单）
- plugin/test/abi-task-status-typing.test.mjs (new)（类型守卫 + 非法值 fail-closed 负控制）
- plugin/test/quay-init-loop-core.test.mjs（laydown 期望集含 task-status.ts）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY scripts= 297 bump）
- tasks/gap-abi-status-lifecycle-vocab-scattered-no-named-type.md（自身）

## Needs-Human

**执行 2026-08-28T20:23:53.355Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
