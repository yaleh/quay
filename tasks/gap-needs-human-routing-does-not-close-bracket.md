---
id: gap-needs-human-routing-does-not-close-bracket
title: routing a task to needs-human does not close its telemetry bracket —
  chart2-s2 (21:21, closed manually 21:49) and ac8 (22:33, still open, would
  OVER90 at 23:19); same code path, 72 min apart; needs-human is terminal so the
  bracket must close at route time
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

**路由到 `needs-human` 时没有闭合遥测括号**。两次实例、同一代码路径、72 分钟间隔：

| 实例 | needs-human 时刻 | 括号状态 | 处置 |
|---|---|---|---|
| chart2-s2-test-assertions-stale-... | 21:21:16（fan-in 冲突） | **未闭合**（外层 21:47 预警） | 外层 21:49 手动 `--task-end needs-human` |
| ac8-import-over-spawn-... | 22:33:57（fan-in 冲突：own-file conflicts with integration） | **未闭合**（58min，~23:19 会触发 OVER90） | 外层 22:4x 手动 `--task-end needs-human` |

手动关掉一个之后 72 分钟，同一条路径又产生一个 ⇒ **21:49 是【补实例，不是修机制】**——needs-human 路由不闭合括号这件事本身没有变。

## 为什么更靠前

比 `gap-over90-clock-measures-queue-time-not-work-time` 更上游：时钟语义（测排队 vs 工作）可以再议，但**路由到 needs-human 时必须闭合括号**无争议——needs-human 是终态（terminal），任务不再执行，括号不该继续开、更不该让 90 分钟时钟在终态上跑。

## 实测

- 两次 needs-human 都由 inner fan-in 冲突触发（own-file conflicts / unrelated task-file conflicts）
- 两次括号都由外层手动 `--task-end --outcome needs-human` 关闭（tick 文档 605 行）
- 若未手动关：ac8 会在 23:19 触发 OVER90 → 全局停派（含 shipped-ts / prefriction 正常工作）

## 修复方向（接法留执行时）

**闭合动作应发生在路由时，不是外层事后**：
1. inner 侧：fan-in 冲突 → 路由 needs-human 的同一处，调用 `--task-end --outcome needs-human`（或等效）。
2. 外层侧：收尾例程对 `needs-human` 任务做括号检查（若 inProgress 有 needs-human 任务的括号则闭合）——tick 文档 605 行已有手动路径，做成机械。
3. 接入点记录：本次关闭动作发生在外层 22:4x tick（手动 `--task-end`），改机制时在此接入。

## AC（draft）

- [ ] 一个任务被路由到 needs-human 时，其遥测括号在同一轮内闭合（不在 inProgress 停留）
- [ ] 负控制：构造 fan-in 冲突 → needs-human ⇒ 括号立即闭合，不触发 OVER90
- [ ] 外层收尾例程对残留的 needs-human 括号机械检查（不靠人盯）

## DoD（draft）

- [ ] 连续 N 个 needs-human 路由，均无括号滞留 inProgress（无 OVER90 触发）
- [ ] 完整套件绿

## Evidence

- chart2-s2 needs-human 21:21:16，括号外层 21:49 手动关（22:0x 前一直开）
- ac8 needs-human 22:33:57，括号外层 22:4x 手动关（58min 时）
- shipped-ts needs-human ~23:0x，括号 50.7min 时外层自发现并关（第 3 次）
- 三次均 fan-in 冲突触发 needs-human

## 复发率量化（2026-08-06 23:0x，管理者计算 + 外层确认）

- 21:21 到 23:09 共 **108 分钟 3 次 ≈ 每 36 分钟一次**，三次都需要人工闭合。
- **触发源是 fan-in 冲突，fan-in 数量随派发量增长**：绿之前派发受阻，缺陷偶尔露头；绿之后 restore-dispatch 恢复，三次里两次挤在最近 40 分钟。
- ⇒ **不是"随时间衰减"的缺陷，是"循环越健康、它咬得越频繁"**——吞吐提升本身推高发生率。通常"罕见往后排"的推理在此**反转**。
- 期望代价 = **复发率 × 在飞任务数 × 停派时长**——三个因子都随派发量上升 ⇒ **超线性**。

## 接线问题，非能力问题（优先级支持）

管理者核实：`--task-end --outcome <done|needs-human|...>` **已存在**于 fast-mode-telemetry.ts。⇒ 修法极小：在 needs-human 路由处调用已存在的 `--task-end --outcome needs-human`（或外层收尾例程机械检查）。看着像"手动能兜住的小事"，但**兜住的成本正随吞吐上升**，修法却很小——建议优先。
