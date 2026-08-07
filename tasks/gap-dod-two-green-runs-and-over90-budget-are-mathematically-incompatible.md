---
id: gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible
title: DoD's 连跑 2 次全绿 (2× 37.5min suite = 74.9min) consumes 83% of OVER90's
  90-min budget, leaving <16 min for actual work —
  observer-registry(106m)/manager-layer(102m) overruns are STRUCTURAL (the DoD's
  own requirement eats the budget), not task problems; the 90-min budget was
  calibrated pre-concurrency-1 (suite 7-15min) and never re-verified after 08-06
  14:21 (e846cedd); needs human numeric ruling (budget/DoD-times/concurrency
  pick-2-of-3)
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**DoD 的「连跑 2 次全绿」与 OVER90 的 90 分钟预算在数学上不相容——越线是结构性的，不是任务问题。**

### 数学（可复算）

| 量 | 值 | 来源 |
|---|---|---|
| 单次全量套件 | **37.5 分钟**（2248421ms） | `.quay/full-suite-state.json`（2026-08-06 21:25 完成） |
| DoD「连跑 2 次全绿」 | **74.9 分钟** | 37.5 × 2 |
| OVER90 预算 | **90 分钟** | fast-mode-telemetry 的 90 分钟阈值 |
| 留给实际工作 | **< 16 分钟** | 90 − 74.9 |

**74.9 / 90 = 83%。** 一个任务只要被要求「连跑 2 次全绿」，它把 83% 的预算花在套件上，剩下不到
16 分钟给实际工作——**任何超过 16 分钟的真实工作都会触发 OVER90 停派**。

### 为什么这是结构性必然而非任务问题

**实测实例（2026-08-06 晚，管理者）**：observer-registry **106 分钟**、manager-layer **102 分钟**——
两者都「越线」。但按上面的数学，它们的 DoD 都要求 2 次全绿 = 74.9 分钟套件时间，剩余预算 15 分钟。
**只要任务含真实实现工作（>15 分钟），越线是必然**，与任务质量无关。把它们标成「任务过大/卡住」是
误判——是判据本身不相容。

### 90 分钟预算的校准背景（旧世界）

`SPEC-suite-speed`（2026-08-03）时代套件 7-15 分钟，DoD 2 次 = 30 分钟，预算余量大。**并发真正降到 1
（2026-08-06 14:21，e846cedd）之后，套件变 37.5 分钟，预算从未重新核实**——校准失效。

### 所需裁定（改判据，归人）

**数字裁定，三选二**：
1. **预算**：OVER90 的 90 分钟 → 按新套件时长重定（如 90 → 150 分钟，或按任务类型分档）；
2. **DoD 次数**：连跑 2 次全绿 → 1 次 + 外层 gate 复核（外层的 full-suite-runner 本身就是一次独立跑）；
3. **并发**：恢复 >1 并发让套件回到旧时长（但 concurrency-1 是为降 load 的已定决策，方向相反）。

**不预设答案**——三个选项各有代价（预算拉长会让真卡死更晚被发现；DoD 减次削弱「连跑」的稳定性保证；
恢复并发推翻 08-06 的降载决策）。归人裁定，本任务只立数字与不相容性。

### 与本任务同族的既有缺口（交叉标注）

- `gap-over90-clock-measures-queue-time-not-work-time`（todo）：OVER90 时钟口径——本任务是它「时钟预算
  本身就不够」的互补面；
- `gap-needs-human-routing-does-not-close-bracket`（todo）：括号生命周期——预算被吃光后 brackets 更易滞留。

## Contract

```
measure suite_minutes = `python3 -c "import json; print(round(json.load(open('.quay/full-suite-state.json'))['durationMs']/60000,1))"` stdout 数字段（当前 37.5）
measure dod_two_runs_pct = `python3 -c "import json; d=json.load(open('.quay/full-suite-state.json'))['durationMs']/60000; print(round(d*2/90*100,1))"` stdout 数字段（当前 83.3）
band dod_two_runs_pct = < 100（= 判据相容；当前 83.3 已贴线，仅剩 16.7% 余量）
invariant OVER90 预算、DoD 连跑次数、并发三者必须在新套件时长下重新校准；任何一方不改，越线都是结构性必然
invoke `python3 -c "import json; d=json.load(open('.quay/full-suite-state.json')); print(round(d['durationMs']/60000,1))"`
control 把套件时长改回 7 分钟（旧世界）⇒ 83.3% 降到 <30%，证明不相容是「新套件时长」引入的，不是任务问题
resume 若中断，先跑 measure 读当前 suite 时长，再读 SPEC-suite-speed 的校准背景
```

## Acceptance Criteria

- [ ] AC1: **不相容性数字固化**——套件时长 / 2 次全绿 / 90 分钟预算三者关系写成可复算公式，
      实测实例（observer-registry 106m / manager-layer 102m）标注为结构性越线
- [ ] AC2: **三选二裁定记录**——人给出预算/DoD 次数/并发的裁定后，本任务按裁定更新判据并实跑验证
      （预算内完成任务不再触发 OVER90）
- [ ] AC3: **负控制**——人为把套件时长设回 7 分钟，公式得出 <30% 余量，证明不相容由时长引入
- [ ] AC4: 与 `gap-over90-clock-measures-queue-time-not-work-time`、`gap-needs-human-routing-does-not-close-bracket` 交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体
- [ ] 人在三选二上给出裁定，判据更新后一个实测任务在预算内完成（不触发 OVER90）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——按裁定后的新判据

## Touches
- orchestration/orchestrator-loop-tick.md（OVER90/DoD 判据段）
- plugin/scripts/fast-mode-telemetry.ts（若裁定改预算）
- .quay/full-suite-state.json（套件时长读数，只读）
- tasks/gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible.md（自身文件）

## Dispatch review

reviewer: none
at: 2026-08-07T02:1xZ
changed: 管理者 2026-08-07 立案（今晚最要紧的发现）。归人裁定（改判据），不预设答案。
