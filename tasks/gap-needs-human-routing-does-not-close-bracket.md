---
id: gap-needs-human-routing-does-not-close-bracket
title: terminal-path routing lacks a unified bracket-close point — needs-human
  (chart2-s2/ac8/shipped-ts) AND complete-but-not-done (residue-check) both
  leave telemetry brackets open; 4 instances, all closed manually by outer
status: ready
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

## 落地（2026-08-11 inner 实现，`gap-needs-human-routing-does-not-close-bracket`）

**统一括号闭合点 = `closure-lag-check.sh --close-task --taskId <id> --outcome <needs-human|done>`**（单一写路径，读 telemetry report 的 inProgress[] 找 runId——调用方不需持 runId，崩后重启也鲁棒；无括号则幂等 exit 0）：
1. **inner 侧**：fan-in 冲突 → needs-human 的同一处（`plugin/loop/fast-mode-loop-tick.md` 步骤 2 与判断边界表），调 `--close-task --outcome needs-human`；fan-in 成功 / 任务完成无需 fan-in 时，调 `--close-task --outcome done`。**翻 done 仍由外层 1b 独占**（写所有权，`gap-task-file-develop-integration-drift-fan-in-conflicts`）——括号闭合与 status 翻转解耦，括号在终止/完成同轮闭合、不停留 inProgress。
2. **外层侧**：`closure-lag-check.sh --close-terminal` 扫描 inProgress 中任务已终态（needs-human / done / done-ready=work landed+AC 全勾仍 ready）的括号并机械闭合——`orchestration/orchestrator-tick-core.md` B1 每 tick 先跑它，把「手动 --task-end needs-human」做成机械。
3. 接线记录：四次关闭均发生在外层 tick（手动 `--task-end`）；本实现让 inner 路由 + outer 收尾两条路径都机械闭合。

## AC（draft）

- [x] 任务进入终态（needs-human / 完成）时，其遥测括号在同一轮内闭合（不在 inProgress 停留）
- [x] 负控制：构造 needs-human 路由 + 完成路径 ⇒ 两种终态括号均立即闭合，不触发 OVER90
- [x] 外层收尾例程对终态任务括号机械检查（不靠人盯）

## DoD（draft）

- [x] 连续 N 个终态路由，均无括号滞留 inProgress（无 OVER90 触发）——测试覆盖 needs-human / done / done-ready 三种终态，每次闭合后 inProgress 无残留
- [ ] 完整套件绿——外层 verification-round 判据，inner 不跑全量（scoped 门已绿见 Evidence）

## Contract

measure needs_human_closed = `node --test plugin/test/closure-lag-check.test.mjs 2>&1 | grep -cE "AC2 needs-human — --close-task closes an open bracket with outcome needs-human"` stdout 数字段（= 1：needs-human 路由关括号测试通过）
measure completion_closed = `node --test plugin/test/closure-lag-check.test.mjs 2>&1 | grep -cE "AC2 completion — --close-task closes an open bracket with outcome done"` stdout 数字段（= 1：完成路由关括号测试通过）
measure terminal_scan_closed = `node --test plugin/test/closure-lag-check.test.mjs 2>&1 | grep -cE "AC3 — --close-terminal closes needs-human"` stdout 数字段（= 1：外层机械扫描关括号测试通过）
measure all_tests_green = `node --test plugin/test/closure-lag-check.test.mjs 2>&1 | grep -cE "pass 15"` stdout 数字段（= 1：15 个测试全绿，含两个终态负控制均无 inProgress 残留）
band needs_human_closed = 1 且 completion_closed = 1 且 terminal_scan_closed = 1 且 all_tests_green = 1
invoke `bash scripts/test.sh --for-task gap-needs-human-routing-does-not-close-bracket --allow-thin 2>&1 | tail -3`
control 括号闭合只经一个写路径（closure-lag-check.sh --close-task / --close-terminal，fast-mode-telemetry.ts --task-end 的下游单一写者）；inner 在终止/完成路由调用、外层 B1 每 tick 先跑 --close-terminal 机械扫描——不靠人盯；同一记账面反向（closedButLive，括号关但进程活）由 `gap-closed-bracket-leaves-live-agent-consuming-slots` 覆盖
resume 若中断，先 `node --test plugin/test/closure-lag-check.test.mjs` 确认 15 绿，再跑 `bash scripts/test.sh --for-task gap-needs-human-routing-does-not-close-bracket --allow-thin 2>&1 | tail -3` 贴输出

## Evidence

- **实现（2026-08-11 inner）**：`plugin/scripts/closure-lag-check.sh` 新增 `--close-task`（统一闭合点，幂等）与 `--close-terminal`（外层机械扫描）两模式；`plugin/test/closure-lag-check.test.mjs` 增 7 个用例覆盖两模式；inner tick 文档（`plugin/loop/fast-mode-loop-tick.md` + `orchestration/fast-mode-tick-core.md`）在终止/完成路由接入 `--close-task`；外层核 `orchestration/orchestrator-tick-core.md` B1 每 tick 先跑 `--close-terminal`。
- **scoped 门实跑**：`bash scripts/test.sh --for-task gap-needs-human-routing-does-not-close-bracket --allow-thin` → closure-lag-check.test.mjs 15 pass + fast-mode-telemetry.test.mjs 全绿（见提交 2）。
- **负控制实测**：needs-human 路由 + 完成路径（done）构造后，`--close-task` 均立即闭合括号（inProgress 空、tasks[] 带终态 outcome、零 orphaned）——不触发 OVER90。
- chart2-s2 needs-human 21:21:16，外层 21:49 手动关（历史）
- ac8 needs-human 22:33:57，外层 22:4x 手动关（历史）
- shipped-ts needs-human ~23:0x，外层自发现手动关（历史）
- **residue-check 完成（10/10 AC）但任务留 ready、括号 76.5min 未闭合，外层 00:0x 手动 `--task-end done` + 翻 done**（历史）
- `--task-end` 已存在于 fast-mode-telemetry.ts（接线问题）——本任务把接线做进统一闭合点

## 交叉标注（AC4，2026-08-08，`gap-closed-bracket-leaves-live-agent-consuming-slots`）

**本任务是「括号该关没关」（正向，括号滞留 inProgress）——同一族的方向另一面是「括号关了但 agent
进程还活着」（反向，`gap-closed-bracket-leaves-live-agent-consuming-slots`）**。两方向共享同一个根：
**括号闭合 ≠ agent 退出，两个可观测独立**。本任务正向 = 括号滞留 inProgress（OVER90）；反向 = 括号已关
但进程仍占槽（槽位记账读括号判空 ⇒ 可能派新任务进实际忙的槽）。槽位记账的修复（`fast-mode-telemetry.ts`
`--slots` 的 `closedButLive` / `occupied_slots`、`slot-refill.ts` 的 `--closed-but-live`）与正向的
`--reconcile` 是同一记账面的两个方向。

## Dispatch review

reviewer: none
at: 2026-08-11T00:00:00Z
changed: 无（inner 直接实现，无外层介入）

## Touches

- plugin/scripts/fast-mode-telemetry.ts（`--task-end` CLI，下游单一写者）
- plugin/scripts/closure-lag-check.sh（`--close-task` / `--close-terminal` 统一闭合点）
- plugin/test/closure-lag-check.test.mjs（两模式测试）
- orchestration/orchestrator-tick-core.md（外层闭合 pass 步骤：B1 先跑 `--close-terminal`）
- orchestration/fast-mode-tick-core.md（inner 核：A6/A16/C2 统一闭合点）
- plugin/loop/fast-mode-loop-tick.md（inner 源文档：步骤 2 与判断边界表接入 `--close-task`）
- plugin/scripts/capability-catalog.sh（catalog 条目更新）
- tasks/gap-needs-human-routing-does-not-close-bracket.md
