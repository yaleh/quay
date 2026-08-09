---
id: gap-batch-merge-freshness-gate-ignores-scope
title: "integration-batch-merge.sh 新鲜度门只看 state==green + 时间新鲜度，不读 scope——任何 worktree 来源的绿都能满足批量合门（scope 字段造好了、理由写清了、最该读的消费者没读）"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**批量合门的新鲜度检查只认 `state=="green"` + 时间新鲜度，完全不看 state 的 `scope` 字段（main vs worktree）——任何 worktree 来源的绿都能满足门，包括一个跟合并目标毫无关系的 worktree 跑出来的绿。**

**实证（manager 2026-08-09 02:1x 核实，外层复核）**：`plugin/scripts/integration-batch-merge.sh` 全文 grep `scope` 命中 **0**；其新鲜度门只读 `${repo_root}/.quay/full-suite-state.json` 的 `state=="green"` + `finishedAt` 时间窗。而 runner 自己（`full-suite-runner.ts:184-190`）写明 scope 字段的存在理由：**main = subagent 等的信号，worktree = deferrable**。⇒ 字段造出来了、理由写清楚了、最该用它的那个消费者（批量合门）没读。

**这次是良性巧合**：round-10 的 worktree（/tmp/quay-intg2 @ aae5365f）检出的正是要合的那棵树——但门本身分辨不出来。若某次 worktree 绿来自一棵与合并目标无关的树（例如另一任务的工作树），门照样放行，把未验证内容合进 develop。

**与今晚已见过的两个未接线机制同族**：forkBaseline 默认分支从未走到、decideIntegrationToDevelopMerge 无非测试调用者——机制建好但没接线。

**修的方向（实现归内层，方向 manager/外层已定）**：
- 候选 A：**scope 感知门**——批量合门要求绿来自 main（`scope=="main"`），或至少要求 green 的来源树 == 合并目标（按 worktree HEAD / state runId 校验）。
- 候选 B：**runId 溯源**——门校验 state 的 runId 对应的 runner 测的是哪棵树（worktree HEAD），与合并目标比对。
- 候选 C：**文档/契约**——门文档写明「绿必须来自要合的树」，机械强制候选 A/B。

**验证锚**：修后，(a) 一个 worktree 来源的绿（与合并目标无关的树）不满足批量合门；(b) main 来源的绿照常通过；(c) 本轮的良性场景（worktree 检出即要合的树）仍可通过（同树绿）。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 scope-grep=0 实证 + full-suite-runner.ts:184-190 设计意图（本任务 Proposal 已含）；内层补构造复现：worktree 绿（不同树）满足门 vs main 绿
- [ ] AC2: **scope 感知门**——批量合门对 worktree 来源的绿（或来源树 ≠ 合并目标）fail-closed；main 绿照常（或等效机制）
- [ ] AC3: **良性场景不破坏**——同树 worktree 绿（本轮形状）仍可通过，或明确要求 main 绿（同步改外层验证流程）
- [ ] AC4: **既有 gate 测试不回归**——integration-batch-merge.test.mjs 全绿（`--for-task` scoped）
- [ ] AC5: **文档同步**——integration-batch-merge.sh 头注释的新鲜度门说明补 scope 语义

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：构造「worktree 绿来自别的树」不满足门、「同树绿」满足，贴任务体
- [ ] 既有 integration-batch-merge 测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/integration-batch-merge.sh（新鲜度门读 scope / runId 溯源）
- plugin/test/integration-batch-merge.test.mjs（新增 scope 门测试）
- plugin/scripts/full-suite-runner.ts（若 runId→树溯源需暴露 HEAD 字段）
- tasks/gap-batch-merge-freshness-gate-ignores-scope.md（自身：勾 AC + 贴证据）

## Contract

measure   worktree_green_gate_verdict = 构造「worktree 绿 + 来源树 ≠ 合并目标」后 `bash plugin/scripts/integration-batch-merge.sh --dry-run --root <repo> --develop develop --integration integration` 的退出码
band      worktree_green_gate_verdict = 非 0（fail-closed，worktree 外源绿不满足门）
invariant main_green_still_passes = 1（main 来源绿照常通过）
invariant same_tree_worktree_green_passes = 1（同树 worktree 绿不误伤，或流程改 main 验证）
invoke    `bash plugin/scripts/integration-batch-merge.sh --dry-run --root /home/yale/work/quay --develop develop --integration integration`（实跑贴回）
control   worktree 外源绿 ⇒ fail-closed；main 绿 ⇒ 通过；同树绿 ⇒ 通过
resume    scope 门 + runId 溯源 + 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 给判据：scope grep=0 vs full-suite-runner.ts:184-190 设计意图的矛盾——字段造好理由写清消费者没读，与 forkBaseline/decideIntegrationToDevelopMerge 同族的未接线形状；方向已定候选 A/B/C，实现归内层）
