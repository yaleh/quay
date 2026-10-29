---
id: gap-routine-architecture-analysis-god-module-task-transition-mixed-concerns
title: "architecture-analysis: 1,015 lines/47 exports carry two unrelated jobs:
  lifecycle transition decisions (lines 76-242: LIFECYCLE_EDGES,
  decideTransition, patchStatusField) and the t"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
1,015 lines/47 exports carry two unrelated jobs: lifecycle transition decisions (lines 76-242: LIFECYCLE_EDGES, decideTransition, patchStatusField) and the task-status-event substrate (243-1015: schema, carrier, file lock at 447, gitBlobSha at 514, append/read at 742/969).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793251760204` · ts `2026-10-29T05:29:20.204Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`decideTransition`、`patchStatusField`、`taskStatusEventsPath`、`acquireFileLock`、`gitBlobSha`、`appendTaskStatusEvent`、`readTaskStatusTransitions`
- 涉及文件：
- `packages/quay/src/kernel/task-transition.ts:161`
- `packages/quay/src/kernel/task-transition.ts:243`
- `packages/quay/src/kernel/task-transition.ts:447`
- `packages/quay/src/kernel/task-transition.ts:969`
- kind：`god-module`
- verdict：`confirmed`

## Requested action
Extract the status-event substrate into kernel/task-status-events.ts and the generic lock into kernel/file-lock.ts, leaving task-transition.ts as the transition decision table.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T05:29:20.204Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-module-task-transition-mixed-concerns`（routine `architecture-analysis`，runId `architecture-analysis-1793251760204`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Disposition（2026-10-29，worker 派发链执行）

**处置 = 修掉**（不是「已注意到」），按 Requested action 原样拆分，零新增行为：

| 模块 | 拆分前 | 拆分后 | 拆分后职责 |
|---|---|---|---|
| `packages/quay/src/kernel/task-transition.ts` | 1,015 行 / 47 导出 | 240 行 / 15 处 `export` 语句 | **只**保留转换决策表：状态词表、`LIFECYCLE_EDGES`、`decideTransition`、`edgeKindFor`、`patchStatusField`；末尾 `export *` 转发两个新模块 |
| `packages/quay/src/kernel/task-status-events.ts`（new） | — | 770 行 | 事件基底：contract-v1 记录形状、carrier（`task-status-events.jsonl`）、epoch sidecar、lock 内的 append、v0/v1/corrupt 三态读、writer-class registry、read-side view、`gitBlobSha` / `taskStatusEventId` |
| `packages/quay/src/kernel/file-lock.ts`（new） | — | 82 行 | 通用 exclusive-create 锁（`FileLockOptions` / `acquireFileLock` / `releaseFileLock` / `withFileLock`），函数体逐字搬移 |

- **零调用点改动**：`task-transition.ts` 末尾 `export * from "./file-lock.ts"` 与 `export * from "./task-status-events.ts"`，15 处既有 importer（`packages/quay-native/src/store.ts`、`cli/task-log.ts`、`cli/help.ts`、`gate/lifecycle.ts`、`plugin/scripts/{driver-filters,worker-fan-in,ready-pool-check,task-status-events-reconcile,task-ops}.ts` 及测试）的 import specifier 全部照旧解析。
- **唯一一处读数随之改变（如实修正，不是回归）**：`producer.writerModule` 取自 `import.meta.url` 的 realpath，拆分后它指向**真正执行 append 的模块** `kernel/task-status-events.ts`。两个钉住旧路径的测试同步改正（`packages/quay/test/task-transition.test.mjs` 的 realpath 相等、`plugin/test/ready-pool-check-transition-writes.test.mjs` 的 endsWith）；`packages/quay/test/task-log.test.mjs` 的 `DEFINITION` 排除项同步指向新定义文件——否则「定义」本身会被那组枚举当成未声明的 call site 打红。
- **声明面同步**：`docs/carrier-registry.json` 中 `task-status-events.jsonl` 与 `task-status-events-state.json` 两个 carrier 的 `owner` 改为新写者模块（注册表是声明，声明必须与写者一致）。
- **防复发（硬规则 9：规则要造产物，不是写得更醒目）**：`packages/quay/test/task-transition.test.mjs` 新增第 5 组接线钉子——去注释后断言决策模块不再 import 任何 `node:` 内建、不再**定义**任何已移出的符号、且必须转发基底模块；锁归 `file-lock.ts`，append/`gitBlobSha` 归 `task-status-events.ts`。判据读的是**代码位置**（`stripComments` 后正则），散文里提到符号不算数（硬规则 2）。

判定读数（ADR-007 暗轴；由 `plugin/scripts/import-graph-check.ts` 在拆分后的 worktree 上实跑，exit 0）：

- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0

读数含义：拆分未引入环（value/type SCC 均为 0）、未新增 `packages/**`→`plugin/**` 反向边（ratchet 仍为 0）、kernel 边界越界 0 条。

实跑证据（全部在 worktree `gap-routine-architecture-analysis-god-module-task-transition-mixed-concerns`，命令可复跑）：
- `bash scripts/test.sh packages/quay/test/task-transition.test.mjs packages/quay/test/task-log.test.mjs` → 29 pass / 0 fail
- `bash scripts/test.sh plugin/test/ready-pool-check-transition-writes.test.mjs packages/quay-native/test/store.test.mjs packages/quay/test/task-status-events-abi.test.mjs plugin/test/carrier-registry-completeness.test.mjs` → 36 pass / 0 fail
- `node_modules/.bin/tsc --noEmit` → exit 0
- `node --experimental-strip-types plugin/scripts/import-graph-check.ts --root .` → PASS

## Touches
- `packages/quay/src/kernel/task-transition.ts`
- `packages/quay/src/kernel/task-status-events.ts` (new)
- `packages/quay/src/kernel/file-lock.ts` (new)
- `packages/quay/test/task-transition.test.mjs`
- `packages/quay/test/task-log.test.mjs`
- `plugin/test/ready-pool-check-transition-writes.test.mjs`
- `docs/carrier-registry.json`
- `tasks/gap-routine-architecture-analysis-god-module-task-transition-mixed-concerns.md`