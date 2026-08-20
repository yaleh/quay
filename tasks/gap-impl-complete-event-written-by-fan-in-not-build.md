---
id: gap-impl-complete-event-written-by-fan-in-not-build
title: "impl-complete 事件由 fan-in step 4.4 写而非 Build 写——第23条解耦结构性失效，Build 完成但排队中的任务被误计「在实现」占 Build 槽"
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

`impl-complete` 事件的**唯一写入点是 `fan-in-execute.js:607`（step 4.4，suite 绿后、flip 前）**，不是 Build subagent 完成时。Build subagent 报告「impl-complete」只是 JSON 汇报（`--impl-complete` 命令），**从没进事件流**（`fast-mode-telemetry.ts:2080` 的幂等逻辑注释也写明「fan-in writes it after impl completes (suite green)」）。

**结构性失效**（第23条 gap-inflight-states-missing-impl-complete-event 的解耦设计实际未生效）：第23条 AC2 设计「Build 派发闸数『有 start 无 impl-complete』= 真正在实现；落地单飞闸数『有 impl-complete 无 end』= 排队待落地」——但 impl-complete 在 suite 绿后才写，导致「start→impl-complete」这一段实际包含**整个 fan-in suite**，而非只是 Build。于是**Build 完成但排队中的任务（fan-in 队列深度 > 1）没有 impl-complete 事件 ⇒ 派发闸按「在实现」占 Build 槽 ⇒ Build 派发被 fan-in 队列深度无谓限制**（5 个在飞任务实测都只有 start 事件，inner 核实确认）。

## Acceptance Criteria

- [x] AC1: `impl-complete` 事件由 **Build subagent 完成时写**（Build 报告 impl-complete 的同一路径写事件），`fan-in-execute.js:607` step 4.4 改为**幂等跳过**（复用 `fast-mode-telemetry.ts` 已有的 `already marked impl-complete; no second event written` 幂等逻辑）。
- [x] AC2: 负控制落在生产载体——一个 Build 完成、排在 fan-in 队列深处的任务，其 runId 事件文件有 impl-complete 事件（读真实事件流，非 fixture）；「start 无 impl-complete」只含真正在 Build 的任务。
- [x] AC3: scoped 绿 + slot-refill Build 派发计数 / fan-in-execute-paths 相关测试不红。

## Definition of Done

- [x] `impl-complete` 事件在 Build 完成时写入（Build 派发闸「有 start 无 impl-complete」只数真正在实现的），fan-in step 4.4 幂等跳过（真实输出，非 fixture）。

## Evidence

**机制落地**（`--impl-complete` 从「fan-in step 4.4 唯一写方」改为「Build 完成时写 + fan-in 幂等回退」，WIP e5aff3b1 + 本轮核实）：
- `plugin/scripts/fast-mode-telemetry.ts`：`--impl-complete` 的 `--runId` 改为**可选**——省略时自动从任务的**开括号**解析 runId（`--run-id-for` 同款查找：`--task-start` 派发时生成的 runId），Build subagent 不持有 runId、只持 taskId，故此前 Build 侧根本无法写该事件；无开括号 ⇒ **fail-closed**（exit 1、不写，缺 `--task-start` 括号的 Build 完成是异常，不得静默丢边界）。幂等守卫 `hasImplCompleteEvent`（`already marked impl-complete; no second event written`）保持。
- `plugin/workflows/fan-in-execute.js` + `.claude/workflows/fan-in-execute.js`（双拷贝）：step 4.4 注释改为**幂等回退**——Build 路径已写 ⇒ CLI 守卫跳过重写；Build 路径漏写（异常）⇒ 本步补写；`|| true` best-effort 不拦 fan-in。命令本身未变（已带 `--runId` 显式传 + 幂等守卫）。
- `plugin/scripts/workflow-event-schema.mjs` + `experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs`（镜像）：impl-complete 注释改为「PRIMARY 写入方 = Build 完成；fan-in step 4.4 = 幂等回退」。
- `plugin/scripts/slot-refill.ts` **本轮核实无需调整**：Build 派发读 `--report` 的 `implementing` 段（start 无 impl-complete）——Build 完成即写 impl-complete ⇒ 排队任务自动移出 implementing、释放 Build 槽，读法天然正确。

**AC2 生产载体负控制（真实事件流，非 fixture；`plugin/test/fast-mode-telemetry.test.mjs` 新增 3 条）**：
- `--impl-complete`（无 `--runId`）自动解析开括号 runId：真实 CLI 写 `--task-start` 后，Build-side `--impl-complete --taskId <id>`（无 runId）exit 0、报告写入、runId 匹配开括号；`--report` 将该任务归类 awaiting-land（非 implementing）。
- 无开括号 ⇒ exit 1 + stderr `could not resolve an open runId` + 事件目录无该任务 runId 文件（fail-closed，什么都没写）。
- **队列深处任务**：`gap-queued`（start + impl-complete、无 end）= 非 implementing、是 awaiting-land（释放 Build 槽）；`gap-building-2`（只有 start）= implementing（真正在 Build）；`inProgress.length == 2`（两开括号都在）。读的是真实事件流（CLI 写盘 + `--report` 回读）。

**AC3 scoped 绿（真实输出）**：
- `fast-mode-telemetry.test.mjs` → **85/85 pass**（含 3 条新增 Build-side 负控制）。
- `slot-refill.test.mjs` → **96/96 pass**（Build 派发计数 `implementing` 段相关全绿）。
- `fan-in-execute-paths.test.mjs` → **80/80 pass**（⑨ impl-complete step 4.4 幂等回退负控制 2/2）。
- `workflow-event-schema.test.mjs` → **50/50 pass**（schema 注释同步后回归）。
- `fan-in-ts-typecheck-gate.test.mjs` → **17/17 pass**；`npx tsc --noEmit -p tsconfig.json` → **exit 0 干净**。

## Touches

- tasks/gap-impl-complete-event-written-by-fan-in-not-build.md（自身）
- plugin/scripts/fast-mode-telemetry.ts（impl-complete 事件写入点：--impl-complete 自动解析 runId + 幂等逻辑；Build 完成时写事件）
- plugin/scripts/workflow-event-schema.mjs（impl-complete 注释：Build 为主写入方；experiments/ 镜像同步）
- experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs（workflow-event-schema.mjs 的 experiments/ 镜像）
- plugin/workflows/fan-in-execute.js（step 4.4 改幂等回退；双拷贝同步 .claude/workflows/fan-in-execute.js）
- .claude/workflows/fan-in-execute.js（同上）
- plugin/scripts/slot-refill.ts（Build 派发计数读法——本轮核实无需调整：读 implementing 段，Build 完成即写 impl-complete ⇒ 排队任务自动释放 Build 槽）
- plugin/test/fast-mode-telemetry.test.mjs（impl-complete 事件写入点负控制 + Build-side 自动解析 runId）
- plugin/test/fan-in-execute-paths.test.mjs（step 4.4 幂等回退负控制）
- plugin/test/workflow-event-schema.test.mjs（schema 注释同步后回归）
