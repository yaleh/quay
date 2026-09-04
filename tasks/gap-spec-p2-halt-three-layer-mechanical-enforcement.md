---
id: gap-spec-p2-halt-three-layer-mechanical-enforcement
title: "SPEC P2-8: `.halt` 对三层同时机械生效——当前只有外层 tick 边界读 .halt，inner/manager 与代码内强制点未覆盖（SPEC-three-layer-unified-architecture §2.8）"
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**三层统一架构 SPEC（`orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md`）P2-8：「`.halt` 对三层同时机械生效（2.8）。」当前 `.halt` 只有外层 tick 边界读，inner / manager 与代码内强制点未覆盖。**

### 现状（outer 2026-08-09 核实）

- **外层**：`select-preflight.ts` / 外层 tick 的 `checkHalt()` 读 repo-root `.halt`（路径已修正为 repo-root，`gap-halt-sentinel-path-mismatch` 后）。
- **inner**：`fast-mode-tick-core.md` A1 有 `.halt` 哨兵（存在 ⇒ 空转、报告、重新排程），但**机械强制点**（代码/脚本层）未覆盖——`capability-catalog.sh` 里 `supervisor-preempt.sh` 声明了「process-level preempt(.halt)」但**无对应实现接线**（只有文档条目）。
- **manager**：`manager-tick-core.md` A5 有 `.halt` 组合判据（无.halt + >24h 无产出 ⇒ 未标记停摆），但同样只在 tick 边界。
- **代码强制点**：`os-anchor-watchdog.sh` 有 `halted=1` 分支（parked 项目不 fight .halt），但那是**崩溃自愈的 watchdog**（已随人裁定 b6f08e1e 非交付物），不是三层统一强制点。

**为什么重要**：`.halt` 是「暂停后忘了」的唯一防线（外层 A3）。若只有外层 tick 边界读它，inner 的派发/执行循环、manager 的观测循环都可能在一个 `.halt` 已放置但各自 tick 未触发时继续推进——「暂停」不机械、不统一。SPEC 2.8 要求**三层同时**机械生效。

**修的方向（产品代码，归内层）**：
- 候选 A：**统一 halt 检查点**——一个 `plugin/scripts/halt-check.sh --for <layer>`（或复用现有 `ready-pool-check` 的 halt 逻辑），三层各自的 tick 入口 + 关键循环点调用；`.halt` 放置后下一执行点即停。
- 候选 B：**代码级强制**——`capability-catalog.sh` 里声明的 `supervisor-preempt.sh`（process-level preempt）实现落地，三层共享。
- 候选 C：**组合判据升级**——把 `无.halt` + `>24h 无产出` ⇒ 未标记停摆 的组合判据从 tick 文档（A3/A5/A1 已写）升级为机械检查（类似 closure-lag-check 的独立脚本），三层共用。

**验证锚**：修后，(a) 放置 `.halt` 后 inner / manager / outer 各自的下一执行点都停（三层实测）；(b) `无.halt` + 长期无产出 ⇒ 组合判据机械报出；(c) 移除 `.halt` 后恢复。

## 执行记录（2026-08-09，inner 实现 + 三层实测）

**落地**：统一检查点 `plugin/scripts/halt-check.sh --for <layer> --json`（fail-closed 读 `.halt`，
同形 `supervisor-preempt.sh halt-check`；组合判据 `stall` = `无 .halt` 且 最后提交 > 阈值(默认24h) ⇒
未标记停摆）。三层 tick 入口接线：inner `plugin/loop/fast-mode-loop-tick.md` 步骤 0、outer
`orchestration/orchestrator-loop-tick.md` 步骤 0d、manager `orchestration/manager-loop-tick.md` 步骤 1a。
`capability-catalog.sh` 声明 `halt-check.sh`（QUESTION + PUBLIC_ENTRYPOINTS，AC1c 门绿）。
新增测试 `plugin/test/halt-check.test.mjs`（13 条：fail-closed / 组合判据 / 三层 measure / --projects）。

**(a) 放置 `.halt` ⇒ 三层停**（`echo "pause all layers | 解除: x" > .halt` 后逐层 `--json`）：
```
layer=outer   halted=True reason=pause all layers | 解除: x   stall=False
layer=inner   halted=True reason=pause all layers | 解除: x   stall=False
layer=manager halted=True reason=pause all layers | 解除: x   stall=False
```
measure `three_layer_halt_effective` = 3 个 `halted` 字段全 true（band 3 达成）。

**(c) 移除 `.halt` ⇒ 三层恢复**（`rm .halt` 后逐层 `--json`）：
```
layer=outer   halted=False
layer=inner   halted=False
layer=manager halted=False
```
invariant `halt_removal_resumes` = 1。

**(b) 组合判据机械报出**（临时 git 仓，提交 backdate 81h，无 `.halt`）：
```
no .halt + stale commit: halted=False stall=True | unmarked stall (SPEC 2.8): no .halt AND last commit 81.15 h ago > 24.00 h thresh
.halt present + stale commit: halted=True stall=False
```
invariant `halt_combination_mechanical` = 1；有 `.halt` 的标记停不报未标记停摆（负控制）。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录现状（三层 `.halt` 覆盖矩阵：外层 tick 边界读 / inner 文档有但代码未接 / manager 文档有组合判据 / watchdog 已非交付物）（本任务 Proposal 已含）
- [x] AC2: **三层同时机械生效**——放置 `.halt` 后 inner / manager / outer 各自的下一执行点都停（三层实测贴任务体）
- [x] AC3: **组合判据机械化**——`无.halt` + `>24h 无产出` ⇒ 未标记停摆报出（非只写文档）
- [x] AC4: **移除即恢复**——删 `.halt` 后三层恢复推进（负控制）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 capability-catalog / 相关 tick 文档契约检查）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：三层各放置/移除 `.halt` 各一次，停/恢复实测贴任务体；组合判据报出实测
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/halt-check.sh（候选 A 路径——统一 halt 检查点，实现时落地，具体文件名以实现为准）
- plugin/loop/fast-mode-loop-tick.md + orchestration/orchestrator-loop-tick.md + orchestration/manager-loop-tick.md（三层 tick 入口接 halt 检查）
- plugin/scripts/capability-catalog.sh（候选 B：supervisor-preempt.sh 声明的实现接线；或标注已由候选 A/C 覆盖）
- orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md（P2-8 验收：三层实测贴回）
- tasks/gap-spec-p2-halt-three-layer-mechanical-enforcement.md（自身：勾 AC + 贴证据）
- plugin/test/halt-check.test.mjs（新增测试：统一检查点 fail-closed / 组合判据 / 三层 measure）

## Contract

measure   three_layer_halt_effective = `bash plugin/scripts/halt-check.sh --for <layer> --json` 的 `halted` 字段数
band      three_layer_halt_effective = 3（三层都停；少一层即未达成）
invariant halt_removal_resumes = 1（删 `.halt` 后三层恢复推进）
invariant halt_combination_mechanical = 1（`无.halt`+`>24h 无产出` ⇒ 组合判据机械报出）
invoke    `bash plugin/scripts/halt-check.sh --for <layer>`（三层实跑贴回）
control   放置 `.halt` ⇒ 三层停；移除 ⇒ 三层恢复；`无.halt`+长期无产出 ⇒ 组合报出
resume    分步提交：统一检查点 + 三层接线 + 组合判据机械化，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 建议 (b) 产品代码类排池 + 任务体引用 SPEC 名 ⇒ `strategic=true` 自动生效；P2-8 `.halt` 三层机械生效——现状核实：外层 tick 边界读、inner/manager 文档有但代码未接、watchdog 非交付物。实现归内层）
