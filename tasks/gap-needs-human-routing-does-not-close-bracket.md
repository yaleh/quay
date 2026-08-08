---
id: gap-needs-human-routing-does-not-close-bracket
title: terminal-path routing lacks a unified bracket-close point — needs-human
  (chart2-s2/ac8/shipped-ts) AND complete-but-not-done (residue-check) both
  leave telemetry brackets open; 4 instances, all closed manually by outer
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

**任何终止路径都缺少统一的括号闭合点**：路由到 `needs-human` 不闭合括号（前三次），"活干完但任务留 ready"也不闭合括号（第 4 次）。共性是【终止/完成时没有一个统一调用 `--task-end` 的点】，不是特定于 needs-human。

## 实例（四次，全部需外层手动闭合）

| 实例 | 形态 | 触发时刻 | 括号状态 | 处置 |
|---|---|---|---|---|
| chart2-s2-test-assertions-... | needs-human（fan-in 冲突） | 21:21:16 | 未闭合 | 外层 21:49 手动 `--task-end needs-human` |
| ac8-import-over-spawn-... | needs-human（fan-in 冲突） | 22:33:57 | 未闭合 | 外层 22:4x 手动 `--task-end needs-human` |
| shipped-ts-files-are-not-bundled-... | needs-human（fan-in 冲突） | ~23:0x | 未闭合 | 外层自发现手动关 |
| **residue-check-crystallized-as-tool-mode** | **完成但任务留 ready（"done, no fan-in needed"）** | ~23:50 完成 | 未闭合（76.5min） | 外层 00:0x 手动 `--task-end done` + 翻 done |

手动关掉一个后 72 分钟同路径复发；四种形态都靠外层盯防。

## 为什么比"needs-human 不闭合"更靠前

needs-human 是终态、完成也是终态——**任何终态路径都应在路由/完成时调用 `--task-end`**（tick 文档 605 行已有手动路径）。标题原限"needs-human 路由"过窄；真正的修复是**统一闭合点**：终止路径（needs-human）与完成路径（完成→done）都在同一处闭合括号。

## 复发率量化（2026-08-06 23:0x）

- 21:21 → 23:09 三次 ≈ 每 36 分钟一次；加上第 4 次（00:0x）更密。
- 触发源是 fan-in 冲突 + 完成不翻 done，数量随派发量增长 ⇒ **循环越健康、它咬得越频繁**。
- 期望代价 = 复发率 × 在飞任务数 × 停派时长（超线性）。

## 接线问题，非能力问题

`--task-end --outcome <done|needs-human|...>` **已存在**于 fast-mode-telemetry.ts。修法极小：在终止/完成路由处调用它。

## 修复方向（接法留执行时）

**闭合动作应发生在路由时，不是外层事后**：
1. inner 侧：fan-in 冲突 → needs-human 的同一处，调用 `--task-end --outcome needs-human`；任务完成（AC 全勾、无需 fan-in）时调用 `--task-end --outcome done` + 翻 done。
2. 外层侧：收尾例程对**任何**在 inProgress 中但任务已终态（needs-human / done-ready / done）的括号做机械检查闭合——tick 文档 605 行手动路径做成机械。
3. 接入点记录：四次关闭均发生在外层 tick（手动 `--task-end`），改机制时在此接入。

## AC（draft）

- [ ] 任务进入终态（needs-human / 完成）时，其遥测括号在同一轮内闭合（不在 inProgress 停留）
- [ ] 负控制：构造 needs-human 路由 + 完成路径 ⇒ 两种终态括号均立即闭合，不触发 OVER90
- [ ] 外层收尾例程对终态任务括号机械检查（不靠人盯）

## DoD（draft）

- [ ] 连续 N 个终态路由，均无括号滞留 inProgress（无 OVER90 触发）
- [ ] 完整套件绿

## Evidence

- chart2-s2 needs-human 21:21:16，外层 21:49 手动关
- ac8 needs-human 22:33:57，外层 22:4x 手动关
- shipped-ts needs-human ~23:0x，外层自发现手动关
- **residue-check 完成（10/10 AC）但任务留 ready、括号 76.5min 未闭合，外层 00:0x 手动 `--task-end done` + 翻 done**
- `--task-end` 已存在于 fast-mode-telemetry.ts（接线问题）

## 交叉标注（AC4，2026-08-08，`gap-closed-bracket-leaves-live-agent-consuming-slots`）

**本任务是「括号该关没关」（正向，括号滞留 inProgress）——同一族的方向另一面是「括号关了但 agent
进程还活着」（反向，`gap-closed-bracket-leaves-live-agent-consuming-slots`）**。两方向共享同一个根：
**括号闭合 ≠ agent 退出，两个可观测独立**。本任务正向 = 括号滞留 inProgress（OVER90）；反向 = 括号已关
但进程仍占槽（槽位记账读括号判空 ⇒ 可能派新任务进实际忙的槽）。槽位记账的修复（`fast-mode-telemetry.ts`
`--slots` 的 `closedButLive` / `occupied_slots`、`slot-refill.ts` 的 `--closed-but-live`）与正向的
`--reconcile` 是同一记账面的两个方向。
