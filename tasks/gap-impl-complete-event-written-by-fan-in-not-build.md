---
id: gap-impl-complete-event-written-by-fan-in-not-build
title: "impl-complete 事件由 fan-in step 4.4 写而非 Build 写——第23条解耦结构性失效，Build 完成但排队中的任务被误计「在实现」占 Build 槽"
status: ready
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

- [ ] AC1: `impl-complete` 事件由 **Build subagent 完成时写**（Build 报告 impl-complete 的同一路径写事件），`fan-in-execute.js:607` step 4.4 改为**幂等跳过**（复用 `fast-mode-telemetry.ts` 已有的 `already marked impl-complete; no second event written` 幂等逻辑）。
- [ ] AC2: 负控制落在生产载体——一个 Build 完成、排在 fan-in 队列深处的任务，其 runId 事件文件有 impl-complete 事件（读真实事件流，非 fixture）；「start 无 impl-complete」只含真正在 Build 的任务。
- [ ] AC3: scoped 绿 + slot-refill Build 派发计数 / fan-in-execute-paths 相关测试不红。

## Definition of Done

- [ ] `impl-complete` 事件在 Build 完成时写入（Build 派发闸「有 start 无 impl-complete」只数真正在实现的），fan-in step 4.4 幂等跳过（真实输出，非 fixture）。

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
