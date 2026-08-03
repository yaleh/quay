---
id: ADR-022
title: "Retire the classic milestone loop: the two-layer fast mode is the sole
  development mode, and the pipeline's remaining 72-hour usage is the cost of the
  mode being abandoned, not evidence of its value"
status: accepted
date: 2026-08-03
tags:
  - process
  - methodology
  - architecture
applies-to:
  - .claude/workflows/prepare-milestone.js
  - .claude/workflows/execute-milestone.js
  - experiments/quay-perpetual-stream/OUTER-LOOP.md
  - experiments/quay-perpetual-stream/scripts/composite-*.ts
  - CLAUDE.md
---

## 裁定

**经典里程碑循环（`OUTER-LOOP.md` + `prepare-milestone` + `execute-milestone` + composite 相位）
应当被放弃。双层快速模式是唯一的开发模式，全面应用。**

人 2026-08-03 04:3xZ 裁定。触发它的是一个反向证据被反过来读。

## 触发：一个被我读反的证据

`gap-no-inventory-of-what-the-two-layer-mode-actually-runs` 的窗口差集显示：
`.claude/workflows/*.js` 六个脚本在 15.9 小时窗口全部 `unaccounted`，
但在 **72 小时窗口五个是 `live`**——`prepare-milestone` 被调用 **280 次**、
`execute-milestone` **47 次**。

外层据此建议「经典循环在用它，不是遗留，retire 任务要重估规模主张」。

**人的裁定把这个证据反过来读了**：

> 那 280 次调用**不是价值证据，是正在被放弃的那个模式的成本**。

## 支持裁定的实测

| | 经典循环 | 双层快速模式 |
|---|---|---|
| 成功率 | **6.9%**（232 条遥测，记录于 `gap-dispatch-gate-has-no-checklist-and-no-trace`） | **92%**（22 done / 24 完成） |
| 墙钟 | 73.5 小时 | **18.0 小时** |
| ProposalReview + PlanCheck 占成本 | **55%** | 已被 `## Contract` + `task-contract-check.ts` 取代 |

**约 13 倍的成功率差距。**

### 快速模式已覆盖经典循环的每个相位（实证，非推断）

| 相位 | 快速模式的对应物 | 证据 |
|---|---|---|
| worktree 隔离 | `git worktree add /tmp/quay-wt-<task>` | 3 个活跃 worktree |
| 对抗审查（Audit / REFUTE） | subagent REFUTE 轮 | 近 12 小时 12 次提交提及 |
| 全量套件把关（Gate） | 「连跑 2 次全绿」+ 三条判绿条件 | 每个任务的 DoD |
| 机制审查（ProposalReview / PlanCheck） | `## Contract` 六键 + `## Dispatch review` + `task-contract-check.ts` | 落地一小时内抓到设计者本人三次 |
| 里程碑簿记 | 任务体 + `.quay/fast-mode-telemetry.jsonl` | 遥测含窗口吞吐与死时间 |

## 退役的闸：10 个「读者」里只有 3 个是真依赖

`milestones/M` 被 10 个非管线脚本引用。**逐个判断引用类型**后：

| 类型 | 脚本 | 处置 |
|---|---|---|
| **排除 / 举例**（不是依赖） | `touches-orthogonality-check.ts`（注释里拿 `milestones/M155/` 举例）、`select-tests-for-touches.ts`（排除 `milestones/M*/worktrees/`）、`task-status-drift-check.ts`（`BOOKKEEPING_ROOTS`） | 残留清掉后变成死引用，随退役一并清理 |
| **经典专属，不是闸** | `milestone-worktree.ts` —— 快速模式用的是 `git worktree add /tmp/quay-wt-*`，**根本不走它** | **随管线退役**（但见下方次序） |
| **真闸** | `build-evidence-manifest.ts`（近期 subagent transcript 提及 1040 次，`gap-m264` 正在改它）、`workflow-baseline-metrics.ts` | 退役前必须单独裁定：抽出、保留、或随退役 |

`proposal-ledger`、`stage-journal` 的非管线读者为 **0**。

### 次序要点

`gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion` 正在用 `milestone-worktree.ts --clean-stale`
清理经典循环留下的 21 个 `milestones/M*/worktrees`。

**先用它清残留，再随管线退役。** 顺序反了就没有工具去清那 1.1G。

## 明确不在退役范围内

1. **exp5 的度量机器**（`chart2-*`、`git-lens-*`、`governance-product-ratio-*`）——
   exp6 §0 已裁定**封存待阶段 2**，是有意保留不是遗留。
2. **仍被快速模式复用的判定函数**——`checkSplitRecommendation`、`planCheckNextAction`、
   `checkTouchesPair`。它们的宿主文件若退役，这些导出必须先抽出。
3. **本 ADR 不执行删除**。执行在 [[gap-retire-the-prepare-execute-pipeline-cluster]]，
   且该任务必须先读 [[gap-no-inventory-of-what-the-two-layer-mode-actually-runs]] 的 `class` 列
   与 72h 窗口差集。

## 后果

- `CLAUDE.md` 目前把 `OUTER-LOOP.md` 描述为「驱动文档」、把经典循环描述为当前机制——
  **这已经是漂移**（快速模式已是实际机制 18 小时以上）。同步是 retire 任务的 AC6。
- 冷启动产品化的内核随之收窄：inventory 实测 **205 脚本、live 36**，
  而经典循环退役后 live 集合会更小。**新项目要装的是那个更小的集合，不是 205。**

## 诚实的限度

**成功率 6.9% vs 92% 不是同期对照。** 经典循环那 232 条遥测跨越更早的时期，
当时仓库状态、任务难度、模型都不同。这个对比**足以支持裁定方向**，
但不应被引用为「快速模式使成功率提高了 13 倍」的因果主张——
两个模式从未在同一批任务上并行跑过，也不打算补做那个实验。

## 执行状态（2026-08-03，`gap-retire-the-prepare-execute-pipeline-cluster`）

本 ADR 的**删除已执行**：`prepare-milestone.js` / `execute-milestone.js`（`.claude/workflows/` +
`plugin/workflows/`）、`composite-{args,audit,preflight,reconcile,land,manifest-synthesis}.ts`、
`composite-build.ts` / `composite-contracts.ts`（被复用导出抽至 `build-evidence-manifest.ts` 后删除）、
`milestone-preparation-check.ts`（`computeTouchesExpansion` 抽至 `concurrent-batch-scheduler.ts`、
`parsePlanStages`/`validatePlanStructure` 抽至 `prepare-admission-check.ts`）、`diagnose-verify-failure.ts`
及其薄包装 workflow、`milestone-worktree.ts`（reclaim 完成后删除）已全部物理删除。保留：
`workflow-metadata-conformance.mjs`（`it0-dod-check.ts` clause 14 仍在 shell-out 调用它）、
`build-evidence-manifest.ts`（M264 修复所在地 + 抽入的 composite 证据映射）。`CLAUDE.md` /
`OUTER-LOOP.md` / `quay-task-to-plan` skill 已加退役横幅并同步。
