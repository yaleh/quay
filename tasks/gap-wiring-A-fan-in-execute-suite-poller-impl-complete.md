---
id: gap-wiring-A-fan-in-execute-suite-poller-impl-complete
title: 接线任务 A（根因①+③）：死工作流 execute-suite-fix.js 清接线 + suite-poller/firstDelay 撤线
  + impl-complete 无生产调用者
status: ready
labels:
  - gap
  - mechanism
  - wiring
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-20 4 路并行接线审计（72 条去重 done 任务，64 WIRED / 8 NOT-WIRED）。本任务合并根因①+③，Touches 与任务 B、C 零交集（manager 按 Touches 交集算过）。

**根因① 死工作流 execute-suite-fix.js（2 条未接线）**：
- `gap-suite-fix-relaunch-stale-tmux-snapshot`
- `gap-suite-fix-workflow-no-load-sensitive-branch`
- 已核实：该文件全库仅测试引用（checker-mutation-case / sync.sh 复制 / dual-copy-drift-check 维护），**零生产调用者**；真实 suite-fix 路径是 `fan-in-execute.js` 的内联 prompt。
- 先例：`gap-fix-scope-gate-wired-to-wrong-path`（08-18 21:47Z）正是把闸从死路径挪进 fan-in-execute.js 内联 prompt，同形修法照搬。

**根因③ fan-in/dispatch 机制（2 条）**：
- `gap-fan-in-execute-poll-cost-firstdelay-agenttype`：`agentType:'suite-poller'` 落地同批即被 `7b917cd1` 撤销，`.claude/agents/suite-poller.md` 现为零消费者孤儿；`firstDelayMs` 曾真接入 `6d531530`，被架构重写 `d1338f95` 整段删除。任务 done 未随变动重核。
- `gap-impl-complete-event-written-by-fan-in-not-build`：**无生产调用者**。给 fast-mode-telemetry.ts --impl-complete 加自动解析 runId，但全库非测试唯一实际调用者仍为 fan-in 第 4.4 步，与修复前一样；无 dispatch brief 要求 Build 调。落地后 3/3 真实样本时序仍是「suite-green 前几十秒才写」——正是该任务本要修的问题。**连带**：gap-inflight-states-missing-impl-complete-event（本身 WIRED）的字段语义被上游污染——"impl 完成"实为"suite 完成"。

**⛔ 本任务 Touches 边界**：`plugin/workflows/fan-in-execute.js` + `.claude/workflows/fan-in-execute.js` + `plugin/workflows/execute-suite-fix.js`(+`.claude/` 镜像) + `plugin/scripts/fast-mode-telemetry.ts` + `.claude/agents/suite-poller.md` + dispatch brief 文档。**⛔ 不列 slot-refill.ts**（impl-complete 任务体核实过无需调整，列了会与任务 C 冲突）。

## Plan

1. **execute-suite-fix.js 处置**：确认死工作流（零生产调用者已核实），把两条任务（stale-tmux-snapshot + no-load-sensitive-branch）的修复语义并入 fan-in-execute.js 内联 prompt（照 gap-fix-scope-gate-wired-to-wrong-path 先例）。
2. **suite-poller/firstDelay 处置**：确认 `7b917cd1` 撤销 agentType 与 `d1338f95` 删 firstDelay——决定是恢复接线还是显式标记任务体"后续撤销，重新评估"（不能 done 状态不重核）。
3. **impl-complete 处置**：核实无生产调用者（已核），决定：①让 Build 阶段真的调 --impl-complete，或②显式把字段语义改成"suite 完成"并让上游消费方知情（gap-inflight-states 字段污染）。**⛔ 不得让"impl 完成"实为"suite 完成"继续污染语义。**
4. **suite-poller.md 处置**：零消费者孤儿——删除或恢复接线二选一，不留孤儿。
5. **通用接线判据**（manager 强调）：每个改动都有读生产载体的 AC（载体中满足 X 的记录数 ≥ N，N 只计实现落地后窗口）。

## Acceptance Criteria

- [ ] AC1: execute-suite-fix.js 两条任务的修复语义已并入 fan-in-execute.js 内联 prompt（照 gap-fix-scope-gate-wired-to-wrong-path 先例），死工作流不再承载未接线修复。
- [ ] AC2: suite-poller.md 不再零消费者（恢复接线或删除孤儿，二选一不留孤儿）；firstDelayMs/agentType 处置有明确结论（恢复或显式重核）。
- [ ] AC3: impl-complete 语义修正——字段不再"impl 完成"实为"suite 完成"污染；gap-inflight-states 消费方知情并适配；生产载体验证（落地后记录中字段语义正确）。
- [ ] AC4: 每个改动有读生产载体的 AC（载体中满足 X 的记录数 ≥ N，N 只计落地后窗口）。
- [ ] AC5: 全量 suite 绿。

## Definition of Done

- [ ] 4 项根因处置完成 + 生产载体验证（AC4）+ 全量 suite 绿；无死工作流/孤儿文件残留。

## Touches

- plugin/workflows/fan-in-execute.js（内联 prompt 并入）
- .claude/workflows/fan-in-execute.js（双拷贝同步）
- plugin/workflows/execute-suite-fix.js（+ .claude/ 镜像，死工作流处置）
- plugin/scripts/fast-mode-telemetry.ts（impl-complete 语义）
- .claude/agents/suite-poller.md（孤儿处置）
- 相关 dispatch brief 文档
- tasks/gap-wiring-A-fan-in-execute-suite-poller-impl-complete.md（自身）
