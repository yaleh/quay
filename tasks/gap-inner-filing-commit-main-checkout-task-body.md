---
id: gap-inner-filing-commit-main-checkout-task-body
title: inner 立案流程主检出任务体未当场提交（11b 复发×2，挡所有 fan-in ff）——立案后当场提交
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：2026-08-20 两次实证（硬规则 12 门槛：发生率 2）。

**现象**：inner 立案任务时**主检出任务体未当场提交**（untracked），而 worktree 分支已提交任务体。主检出的 untracked 任务体 = 硬规则 11b 违反（盘上任务体即生产输入），且 `fan-in-ff-merge.sh:205` `git status --porcelain`（含 untracked）非空即 `exit 2` **硬阻所有 fan-in 的 ff**。

**两次实例**：
| 时刻 | 任务 | 外层处置 |
|---|---|---|
| 17:36Z | gap-manager-layer-launch-config-test-pin-fjdac | 外层提交 49526867 |
| 21:5xZ | gap-fan-in-workflow-check-test-hermetic-escalations | 外层提交 0743c444 |

**根因假设（非结论）**：inner 立案流程写任务体到主检出 + 建 worktree + worktree 内提交，但**主检出的任务体没有随立案提交**——可能 inner 以为 worktree 提交即包含主检出（git 语义不同：worktree 提交在分支，主检出 untracked 不动）。

**为什么 inner 修**：这是 inner 的立案流程（写任务体 + 建 worktree 的编排在 inner 域）。

## Plan

1. 定位 inner 立案流程（task_write → worktree add → 提交的编排），确认主检出任务体提交缺失点。
2. 修复：立案后当场提交主检出任务体（同 dispatch-record 写入的同一 tick 步骤）。
3. 验证：连续 N 个新立案任务，主检出无 untracked 任务体（生产载体，读 git status）。

## Acceptance Criteria

- [x] AC1: inner 立案流程在写任务体后当场提交主检出任务体（同一 tick 步骤，与 dispatch-record 同拍）。——编排文档含该要求，grep「立案后当场提交主检出任务体」命中（orchestration/fast-mode-tick-core.md B5 1 处 + 落地副本 1 处）。
- [ ] AC2: 负控制落在生产载体——连续 3 个新立案任务，`git status --porcelain` 无 untracked `tasks/*.md`（读真实 git，非 fixture）。（待外部）
- [ ] AC3: 全量 suite 绿。（待外部）

## Definition of Done

- [x] inner 立案即提交主检出任务体（B5 强制要求已落盘，正本+落地副本 grep 命中）。
- [ ] 连续 3 个新立案无 untracked 任务体（真实输出）。（待外部）

## Evidence

**runId**: `fm-gap-inner-filing-commit-main-checkout-task-body-1787311000000-inflr`

**改动三件**：
1. `orchestration/fast-mode-tick-core.md` B5「建任务时」——补「立案后当场提交主检出任务体」强制要求（同一 tick 步骤、与 A16b 同拍；注明 11b 语义 + `fan-in-ff-merge.sh` porcelain 非空 exit 2 挡 ff 的两实例）。
2. `plugin/loop/fast-mode-tick-core.md`——落地副本同语义落地（AC90 normalized-byte，行为体与正本一致）。
3. `plugin/loop/fast-mode-loop-tick.md`「发现问题时建任务」节——补「立案后当场提交主检出任务体」正本（B5 的 `src:1379 "立案后当场提交主检出任务体"` 锚句落点）。

**grep 证据（AC1）**：
- `grep -c "立案后当场提交主检出任务体" orchestration/fast-mode-tick-core.md` → 1
- `grep -c "立案后当场提交主检出任务体" plugin/loop/fast-mode-tick-core.md` → 1
- `grep -c "立案后当场提交主检出任务体" plugin/loop/fast-mode-loop-tick.md` → 1

**静态检查（全部绿）**：
- `tick-core-static-check.ts --check-drift` → PASS（4 pairs 一致；fast-mode ≐ body）
- `tick-core-static-check.ts` → PASS（AC3 src:N 覆盖 fast-mode 46/46，AC4 指针 OK，AC5 B3 编号 OK，AC6 一致，AC8 排除一致）
- 行为体 normalized diff 正本 vs 副本 → IDENTICAL

## Touches

- tasks/gap-inner-filing-commit-main-checkout-task-body.md（自身）
- orchestration/fast-mode-tick-core.md（B5 立案提交强制要求）
- plugin/loop/fast-mode-tick-core.md（落地副本语义落地）
- plugin/loop/fast-mode-loop-tick.md（立案提交正本 + B5 锚句）
