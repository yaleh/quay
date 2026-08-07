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

## 【前提错误：本任务的核心算式建立在一个未核实的假设上 — 管理者 2026-08-07 02:3xZ 自证并撤回】

**撤回的断言**：「一个任务只要被要求连跑 2 次全绿，它把 83% 的预算花在套件上」
以及由它推出的「observer-registry(106m)/manager-layer(102m) 越线是**结构性必然**」。

**错在哪（实测，非推断）**：`plugin/loop/fast-mode-loop-tick.md:114-118` 明写——

> **全量套件本身已移到外层后台**（`gap-full-suite-belongs-to-outer-background-above-3-min` AC1/AC3）：
> **inner 不跑全量**（默认无参路径），只读 `.quay/full-suite-state.json` 的 `state`；
> inner 只保留 `--for-task` 选中集（**秒级**，走 scoped 路径，不触资源闸）。
> 任务收尾（**外层异步**）仍必须连跑 2 次全量全绿才算 done。

⇒ **那 74.9 分钟的全量套件时间根本不发生在 inner 的 OVER90 括号内**——
括号内跑的是**秒级 scoped**，全量由**外层异步**在括号之外完成。
**83% 这个数字对不上任何真实存在的时间预算。**

⇒ **`observer-registry`(106m)/`manager-layer`(102m) 的越线原因，本任务并未查明**。
它们越线是**实测事实**（且均经进程血统核实为真实执行中），
但**归因于 DoD 是错的**，必须另查。

**这条错误的来源与责任**：**算式是管理者（我）在 02:1x 提供的，外层据此重写并强化了标题与论证。
错误是我供的，不是外层的。** 我当时没有核实「DoD 的全量是否在 inner 括号内跑」这个前提——
**正是 `manager-phase-goal.md` AC11 要防的形态：带断言的算式，其前提本身未被验证。**

## 幸存的部分（不作废，但需重新论证）

以下三条**独立于上述错误**，仍然成立：

1. **90 分钟预算确实从未随并发变化重新核实过** —— `e846cedd`(08-06 14:21) 并发真正降到 1 之后，
   所有在旧并发下校准的下游常数都没重算。这条不依赖 DoD 是否在括号内。
2. **单次全量套件 37.5 分钟是实测的**（2248421ms）—— 数字本身没错，错的是它被放进了错误的预算里。
3. **`scripts/test.sh:342-347` 记录的关键事实**（本次新发现，比原论证更有价值）：
   并发 8 时全量 **~8 分钟**（460–570s wall），并发 1 时 **~55 分钟**（Σ≈3300s）；
   注释原文称并发 8 是 **"saturated, not overloaded"**（饱和但未过载）；
   **"lower concurrency to avoid cancel" 是 unproven，而降并发的代价是 definite ~7×**；
   **AC5 的权衡实验从未跑过**——只测了放大侧(17/8=2.125)，**没测代价侧**。

## 重新定向（人 2026-08-07 提出，管理者认为成立）

人的推论：**历史数据在更高并发下显著更低 ⇒ 更高的测试并发是可行的（曾是常态，不是推断）；
若提高测试并发要求降低 inner 的 subagent 并发，那是可以接受的——只要任务真能完成、有吞吐率。**

**管理者判断：这个交换在数学上划算，因为两层对关键路径的作用不对称。**

| 配置 | 进程量级 | 单任务墙钟（全量） | 说明 |
|---|---|---|---|
| 现状 `cap=5 × 并发1` | 5 × 2.1 ≈ **10** | **37.5–55 分钟** | 槽位只是把慢任务复制多份 |
| 交换后 `cap=2 × 并发4` | 2 × 4 × 2.1 ≈ **17** | **~8–15 分钟** | 并发直接缩短关键路径 |

**核心不对称**：OVER90 是**单任务墙钟**问题——**加槽位对"一个任务能否在 90 分钟内完成"毫无帮助**，
提高并发**直接**缩短它。且吞吐上，2 个 8 分钟任务优于 5 个 55 分钟任务。

⇒ **真正该做的不是"三选二松哪条判据"，而是把同一份 CPU 预算从槽位层挪到并发层**——
与 `gap-test-concurrency-cap-does-not-scope-nested-spawns` 的"跨层总预算"是同一个解法的两面。

**仍需实测的唯一一条**：那个从未跑过的 **AC5 代价侧实验**——并发 4/8 时 `cancelled` 是否真会出现。
在证明之前，用"确定的 7 倍代价"换"未被证明的收益"，方向是反的。
