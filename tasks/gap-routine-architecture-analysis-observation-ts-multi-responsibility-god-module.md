---
id: gap-routine-architecture-analysis-observation-ts-multi-responsibility-god-module
title: "architecture-analysis: 4797 lines with 64 direct importers and at least
  four unrelated responsibilities in one file: fast-mode event pairing,
  liveness/activity signals, Touches-sec"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
4797 lines with 64 direct importers and at least four unrelated responsibilities in one file: fast-mode event pairing, liveness/activity signals, Touches-section task-blocking computation, and worker-outcome/mechanical-fan-in record parsing.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792599464308` · ts `2026-10-21T16:17:44.308Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`pairInFlight`、`readActivitySignals`、`decideLiveState`、`computeInFlightBlocking`、`readTaskBlockingInputs`、`parseWorkerOutcomeRecordsDetailed`
- 涉及文件：
- `packages/quay/src/observation.ts:295`
- `packages/quay/src/observation.ts:387`
- `packages/quay/src/observation.ts:474`
- `packages/quay/src/observation.ts:557`
- `packages/quay/src/observation.ts:766`
- kind：`god-module`
- verdict：`confirmed`

## Requested action
Split along those seams into observation/events.ts, observation/liveness.ts, observation/blocking.ts, observation/records.ts and keep observation.ts as a barrel; consumers' imports stay valid.

## Disposition — FIXED (2026-10-22)
复核：在改动前的树上重新量到 4797 行（`packages/quay/src/observation.ts`），finding 描述的四个职责确如所述。
处置：沿 finding 点名的四道缝切开，`observation.ts` 保留装配角色并对其余模块做 barrel 转发：

| 缝 | 新模块 | 行数 | 归属 |
|---|---|---|---|
| fast-mode event pairing | `packages/quay/src/observation/events.ts` | 123 | `pairInFlight`、`readEventsFromDir` |
| liveness / activity signals | `packages/quay/src/observation/liveness.ts` | 463 | `readActivitySignals`、`decideLiveState`、`/proc` 进程与 driver 载体活性、`deriveInFlightPhase` |
| Touches / depends_on blocking | `packages/quay/src/observation/blocking.ts` | 186 | `readTaskBlockingInputs`、`computeInFlightBlocking` |
| worker-outcome / mechanical-fan-in records | `packages/quay/src/observation/records.ts` | 457 | `parseWorkerOutcomeRecordsDetailed`、`parseMechanicalFanIn`、`readFanInAttempts`、round 载体解析 |
| 共享叶子 | `packages/quay/src/observation/model.ts` | 146 | `InFlightTask` 视图模型 + 载体路径常量（唯一 import 是 ABI 的 `TaskStatus` 类型） |

依赖方向单向（seams → model，另有 liveness → records），`observation.ts` 只 import 四个 seam，不被它们 import ⇒ 结构上无环。

可核读数（任务 worktree，实现提交 `d21a018aa`）：
- `packages/quay/src/observation.ts`：4797 → 3584 行。
- 六个被点名符号的新落点：`pairInFlight` → `observation/events.ts:39`；`readActivitySignals` → `observation/liveness.ts:67`；`decideLiveState` → `observation/liveness.ts:102`；`readTaskBlockingInputs` → `observation/blocking.ts:134`；`computeInFlightBlocking` → `observation/blocking.ts:173`；`parseWorkerOutcomeRecordsDetailed` → `observation/records.ts:144`。
- 消费面不变（逐字比对旧/新模块的运行时导出集合）：missing = 0；added = 3（`readEventsFromDir` / `readCarrierText` / `readWorkerRoundInFlightTasks`，均为跨模块后不得不导出的原私有 helper）⇒ 所有既有 `from "./observation.ts"` 导入仍然有效。
- `tsc --noEmit -p tsconfig.json`：绿。
- `plugin/scripts/import-graph-check.ts`：valueSccs=0、typeSccs=0、reverseEdges=0、kernel 越界 0。
- `plugin/scripts/task-file-bypass-check.ts --gate`：39 hits 全部在 allowlist 内，newHits=0。
- 测试批：observation+live-state 64 通过；serve/serve-board/serve-handlers 80 通过；serve-ac95/serve-dashboard/serve-needs-human/ac136/ac292/fan-in 面板/board-transient 82 通过；start-end-like SSOT + session-primitives + dashboard-parallelize + serve-task + cli-live 42 通过。

⛔ 不宣称的部分：文件仍有 3584 行、仍承载 board / git history / journal / AC95 views。finding 点名的四道缝与
requested action 点名的四个文件已全部落地；`observation.ts` 头部已写入 seam map，下一次切分不必从零开始。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `observation-ts-multi-responsibility-god-module`（routine `architecture-analysis`，runId `architecture-analysis-1792599464308`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/observation.ts`
- `packages/quay/src/observation/model.ts`
- `packages/quay/src/observation/events.ts`
- `packages/quay/src/observation/liveness.ts`
- `packages/quay/src/observation/blocking.ts`
- `packages/quay/src/observation/records.ts`
- `tasks/gap-routine-architecture-analysis-observation-ts-multi-responsibility-god-module.md`