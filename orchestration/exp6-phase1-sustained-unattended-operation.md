---
id: exp6-phase1-sustained-unattended-operation
title: "exp6 阶段 1：把已达成的吞吐变成可持续 12 小时无人值守的运行"
status: todo
labels:
  - directive
  - human-steered
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

### 目标最初的表述，与实测的修正

最初的 12 小时目标是：**不用并发时每小时完成 1 个 quay 任务；单任务（含准备与执行）平均 ≤1 小时；
用并发后应有相应增长。**

批次 2 的实测（2026-08-02，计量已接线）：

| 指标 | 目标 | 实测 |
|---|---|---|
| 吞吐（并发） | >1 任务/小时 | **2.1 任务/小时**（6 个任务 / 2.8 小时） |
| 单任务耗时 | ≤60 min | B3-1 **34 min**；B3-2 **67.8 min**（超但未触 90 min 硬上限） |
| 快速模式为底线 | — | 已是默认；批次 2 全部走后台 subagent + worktree + 串行 fan-in |

**吞吐目标已经达成，且有余量。** 所以 12 小时目标的约束不在吞吐，而在**可持续性**——当前它一小时
都跑不了无人值守，原因与速度无关。

### 真正的约束：四个会让循环停摆的条件

tick 的保守停止条件（`docs/analysis/fast-mode-loop-tick.md`）本身是对的，但现在**每一条都处在或
接近触发状态**：

| 停止条件 | 当前状态 |
|---|---|
| `.halt` 存在 | **存在** —— 循环根本不会起步 |
| 全量 suite 非绿 | **非绿** —— 4 个已知失败（3 个既有 + select-preflight 超时） |
| needs-human 积压 ≥3 | 当前 0，但无人值守时无人清理，必然累积 |
| 就绪队列为空 | 当前有任务，但队列耗尽后无补充机制 |

即使现在解除 `.halt`，第一个 tick 走到 fan-in 就会撞上「suite 非绿」立即自停——**解除等于没解除**。

### 因此本任务的真实目标

不是「达成 1 任务/小时」（已达成），而是**让已达成的速率能连续跑 12 小时而不需要人介入**。

这也是 exp6 阶段 1 的收口条件：引擎稳定，才谈得上阶段 2 用它交付 quay 产品
（`docs/proposals/exp6-queue-driven-concurrent-executor.md` §0）。

## Chosen mechanism

四条，按依赖顺序。每条都是**移除一个停摆源**，不是提速。

### 1. 套件归绿并保持

4 个已知失败清零：3 个既有（`symlink-mirror-invocation` ×2、`it0-enforcement-with-design` ×1）
+ `select-preflight` 超时（[[gap-select-preflight-json-real-store-too-slow]]）。

保持的手段是已有的 fan-in 纪律（每次合并后跑全量），不需要新机制。

### 2. `restart-readiness-check.sh` 补 suite-green

它现在 `grep -c "test.sh"` 为 0——只跑 4 个 selfcheck，不跑套件。这是 exp5 遗产：那时它关心
master 的 git 状态，而快速模式下 tick 的停止条件之一**就是**套件绿。

不补的话它会持续给出误导性的 `READY ✓`，导致「按 READY 解除 → 立即自停」的空转。

### 3. 队列补充：耗尽后从任务库取下一批

tick 第 3 节把「就绪队列为空」列为停止条件。无人值守 12 小时不可能靠一个固定批次填满。

需要一个补充步骤：队列空时，按就绪度（依赖满足 + Touches 正交）从任务库取下一批。就绪判定用
**已有的** `select-preflight.ts` / `assembleBatch` / `PARENT-DONE-IFF-CHILDREN`，不新建
（ADR-021 Phase 0）。

### 4. needs-human 积压的处置策略

当前是「积压 ≥3 就停」。12 小时无人值守下这必然触发。两个选项，本任务要**做出选择并记录理由**，
不是二者都实现：

- **A（保守）**：维持现状。代价是 12 小时可能实际只跑 3–4 小时。可接受，只要如实记录停摆时刻与原因。
- **B（放宽）**：needs-human 的任务移出队列继续跑其余任务，积压上限提到 ≥6 或取消。代价是回来时
  面对更多待决策项，且可能在错误方向上多跑几小时。

**倾向 A**，理由是 ADR-021 原则：没有足够真实案例支撑规则化。但这次有了第一批数据（批次 2 产生
1 个 needs-human），可以用它判断。**先跑一次 12 小时，用实际停摆数据决定，而不是预先放宽。**

### 明确不做

- 不提速。吞吐已达标，再优化是解决不存在的问题。
- 不放宽审查（2 轮硬上限保留）。它在批次 2 抓了 3+4+1 个真 bug，是当前质量的主要来源。
- 不把 needs-human 的判断机械化。停下等人是当前正确的默认。

## Plan

```
阶段 A（前置）  套件归绿
  A1  为 3 个既有失败建任务或明确接受
  A2  修 select-preflight 240s 超时
  A3  全量套件 0 失败

阶段 B（机制）  移除停摆源
  B1  restart-readiness-check 补 suite-green
  B2  tick 加入队列补充步骤（复用 select-preflight/assembleBatch）

阶段 C（启动）  真实无人值守
  C1  跑 readiness check（含新的 suite-green），绿
  C2  rm .halt，设 /loop
  C3  连续运行，不介入
  C4  记录每次停摆的时刻与触发条件

阶段 D（判定）  用数据决定
  D1  从 C4 的停摆记录判断 needs-human 策略选 A 还是 B
  D2  从计量数据判断 12 小时的实际有效运行时长与任务数
```

## Acceptance Criteria

- [ ] AC1: `scripts/test.sh` 全量 0 失败，且在 fan-in 后可重现
- [ ] AC2: 3 个既有失败各有 open 任务，或有明确的「接受」决定并写明理由
- [ ] AC3: `select-preflight --json --workspace-root .` 耗时 ≤30s（当前 111s，超时上限 120s，余量仅 8%）
- [ ] AC4: `restart-readiness-check.sh` 包含 suite-green 检查，套件红时报 NOT READY
- [ ] AC5: tick 有队列补充步骤，队列空时按就绪度从任务库取下一批，复用已有就绪判定机制
- [ ] AC6: `.halt` 解除且 `/loop` 已设，指向 `docs/analysis/fast-mode-loop-tick.md`
- [ ] AC7: **连续无人值守运行 ≥12 小时**，期间人不介入（观察不算介入）
- [ ] AC8: 每次停摆记录时刻与触发的停止条件；零停摆也是有效结果，同样记录
- [ ] AC9: 计量覆盖该 12 小时的全部任务——每个都有 `--task-start`/`--task-end`，无 orphaned
- [ ] AC10: 实际吞吐记录：完成任务数、均耗时、tasksPerHour，与批次 2 的 2.1/hr 对比
- [ ] AC11: needs-human 策略（A 保守 / B 放宽）基于 C4 的实际停摆数据做出选择并记录理由，不是预先决定
- [ ] AC12: 12 小时内合并的每个任务，fan-in 前都做了 `git rebase master`（tick 常设规则，B3-2 的教训）

## Definition of Done

- [ ] AC1–AC6 全部满足后才开始 AC7 的 12 小时运行——**不满足就启动 = 已知会自停**
- [ ] 12 小时运行的完整计量报告贴进任务体：任务清单、各自耗时、停摆记录、tasksPerHour
- [ ] 与批次 2 基线（2.1 任务/小时、B3-1 34min、B3-2 67.8min）的对比分析
- [ ] needs-human 策略的选择与理由记录
- [ ] 若 12 小时内停摆 >3 次，分析每次的根因并判断哪些应转为机制修复——这是下一批的输入

## Touches

- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
- docs/analysis/fast-mode-loop-tick.md
- docs/analysis/batch2-queue-state.md
- milestones/fast-mode-telemetry/
