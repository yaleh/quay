---
id: gap-worktree-leak-after-fan-in-occupies-slot-permanently
title: "合并后没删 worktree 的累积泄漏——fast-mode-telemetry:834/:898 判执行体存活=worktree 还在；12 个分支已合 integration 的 worktree 仍留着 ⇒ 每合一个任务永久吃掉一个槽位（occupied 15 > cap 5 ⇒ 空槽恒 0）；inner A6 fan-in 序列含 worktree remove 但 outer A15 fan-in 没有 ⇒ 最近 fan-in 全在 outer 侧执行故泄漏；处方=①清已合 worktree ②A15 fan-in 序列补 worktree remove ③slot-status 报 occupied>cap 且存在【分支已合但 worktree 仍在】⇒ 该轮判不合规"
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**合并后没删 worktree 的累积泄漏。`fast-mode-telemetry.ts:834` 与 `:898` 同形：执行体是否存活，判据是 worktree 还在不在。而 git worktree list 里 15 个 quay-worktrees/gap-* 中 12 个的分支已合入 integration——活干完、合完，worktree 没删 ⇒ 永久算作执行体存活 ⇒ --reconcile 依规矩拒绝关它们（不是【可观察地消失】，这是对的、别改 reconcile）⇒ occupied 15 > cap 5 ⇒ 空槽恒 0 ⇒ inner 按规矩停派。每合并一个任务就永久吃掉一个槽位，单调累积。**

### 实证（manager 2026-08-11 04:5x 第二次更正 + outer 复核）

- **根因**：`fast-mode-telemetry.ts:834` 与 `:898` 判执行体存活 = worktree 还在。
- **泄漏**：12 个分支已合 integration 的 worktree 仍留着（a15-ruling5-counter / ac36-recommended / ac38-outer-doc-drift / delivery-inventory-drift / outer-tick-core-b9 / pool-quality / quay-last-pane / slot-refill-repeats / suite-execution-rollback / suite-red-verdict / task-file-drift / tick-core-zero-static）。只有 3 个真在飞（prereq-gates / serial-install / verification-round-phase-ms）。
- **单调累积**：occupied 15 > cap 5 ⇒ 空槽恒 0 ⇒ inner 按规矩停派。每合一个任务永久吃一个槽位。
- **哪一步丢的**：inner 核 A6 的 fan-in 序列本含（rebase → merge --no-ff → --for-task 复测 → worktree remove）。但最近的 fan-in 全是 outer 在做（提交里是 `outer: merge: fan-in task/...`），**outer 的 A15 路径没有这一步**。
- **--reconcile 是对的、别改**：它只在执行体【可观察地消失】时关闭记录，worktree 还在 ⇒ 不算消失 ⇒ 拒绝关闭。这是正确行为。
- **outer 复核**：清掉 11 个泄漏 worktree 后，slot-status 从 occupied 15/slots-free 0 → occupied 3/slots-free 2（真在飞 3）——根因确认。

### 选定机制方向（实现归 inner，判定归 outer）

**把 worktree remove 补进 outer A15 的 fan-in 序列，与 inner A6 对齐**：
1. **立即**：对已合分支的泄漏 worktree 跑 `git worktree remove`（安全：分支已合，提交不丢，只删工作副本）。
2. **A15 fan-in 序列补 worktree remove**：`merge --no-ff` 后 `--for-task 复测` 后 `git worktree remove`——与 inner A6 序列对齐；否则每合一个就再泄漏一个。
3. **合规产物**：slot-status 报 `occupied > cap` 且存在【分支已合但 worktree 仍在】的条目 ⇒ 该轮判不合规（C17 形状闭合）。

**验证锚**：修后 (a) 泄漏 worktree 清理后 slots-free > 0；(b) A15 fan-in 后 worktree 自动 remove（无泄漏累积）；(c) slot-status 对 occupied>cap+已合残留 判不合规；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 12 泄漏 worktree 清单 + 单调累积（occupied 15 > cap 5）+ inner A6 有 remove 而 outer A15 没有（本任务 Proposal 已含）
- [ ] AC2: **泄漏清理**——已合分支的泄漏 worktree 全部 remove（安全：分支已合，只删工作副本）
- [ ] AC3: **A15 fan-in 补 remove**——outer fan-in 序列 merge 后 `git worktree remove`（与 inner A6 对齐）
- [ ] AC4: **合规产物**——slot-status 报 occupied>cap 且存在已合残留 ⇒ 判不合规；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：泄漏清理后 slots-free > 0（贴 slot-status）；A15 fan-in 后无泄漏累积
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/fast-mode-telemetry.ts（slot-status 加 worktree-leak 不合规判据）
- plugin/test/fast-mode-telemetry.test.mjs（新增泄漏判据用例）
- orchestration/orchestrator-tick-core.md（A15 ④ fan-in 序列补 worktree remove）
- plugin/loop/fast-mode-loop-tick.md（A6 与 A15 对齐注明）
- tasks/gap-slot-free-not-an-event-slots-stay-empty-missed-without-trace.md（交叉标注——本因=worktree 泄漏，事件化其后）
- tasks/gap-worktree-leak-after-fan-in-occupies-slot-permanently.md（自身：勾 AC + 贴证据）

## Contract

measure   slots_free_after_cleanup = `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slot-status --cap 5 --json` 的 stdout 中 slots-free 数字
band      slots_free_after_cleanup > 0（泄漏清理后空槽恢复）
invariant reconcile_unchanged = 1（--reconcile 只在执行体可观察地消失时关闭——源码已有，不改）
invariant a15_fanin_removes_worktree = 1（outer fan-in 序列含 worktree remove）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slot-status --cap 5 --json`（贴 occupied/slots-free）
control   泄漏清理后空槽恢复；A15 无泄漏累积；reconcile 不变；既有不回归
resume    泄漏清理 / A15 补 remove / 合规产物 / 测试分步提交，任一步完成即写盘

> **manager 2026-08-11 05:0x 验证锚补充**：把 git worktree remove 补进 A15 fan-in 序列后，判据是【每次 fan-in 之后 slots-remaining 不下降】；若某轮 fan-in 后它又开始单调下降，说明补的那一步没生效或有别的路径在漏。**这个判据比数 worktree 个数更直接**——它量的正是我们真正在乎的东西（空槽）。

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 04:5x 第二次更正（取代 04:42 陈旧括号案）——真因=合并后没删 worktree 的累积泄漏（fast-mode-telemetry:834/:898 判存活=worktree 在）；12 个已合分支 worktree 仍留 ⇒ 每合一个永久吃一槽（occupied 15>cap5）；inner A6 fan-in 有 remove 而 outer A15 没有。outer 复核：清 11 泄漏后 slots-free 0→2。处方：清泄漏 + A15 补 remove + 合规产物。实现归 inner，判定归 outer
