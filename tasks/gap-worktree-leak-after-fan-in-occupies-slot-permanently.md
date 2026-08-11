---
id: gap-worktree-leak-after-fan-in-occupies-slot-permanently
title: 合并后没删 worktree 的累积泄漏——fast-mode-telemetry:834/:898 判执行体存活=worktree 还在；12
  个分支已合 integration 的 worktree 仍留着 ⇒ 每合一个任务永久吃掉一个槽位（occupied 15 > cap 5 ⇒ 空槽恒
  0）；inner A6 fan-in 序列含 worktree remove 但 outer A15 fan-in 没有 ⇒ 最近 fan-in 全在
  outer 侧执行故泄漏；处方=①清已合 worktree ②A15 fan-in 序列补 worktree remove ③slot-status 报
  occupied>cap 且存在【分支已合但 worktree 仍在】⇒ 该轮判不合规
status: needs-human
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

- [x] AC1: **复现固化**——任务体记录 12 泄漏 worktree 清单 + 单调累积（occupied 15 > cap 5）+ inner A6 有 remove 而 outer A15 没有（本任务 Proposal 已含）
- [x] AC2: **泄漏清理**——已合分支的泄漏 worktree 全部 remove（安全：分支已合，只删工作副本）；`slots_free_restored`（空槽恢复）为真
- [x] AC3: **A15 fan-in 补 remove**——outer fan-in 序列 merge 后 `git worktree remove`（与 inner A6 对齐）
- [x] AC4: **合规产物**——slot-status 报 occupied>cap 且存在已合残留 ⇒ 判不合规；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修后实跑：泄漏清理后 slots-free > 0（贴 slot-status）；A15 fan-in 后无泄漏累积
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/fast-mode-telemetry.ts（slot-status 加 worktree-leak 不合规判据）
- plugin/test/fast-mode-telemetry.test.mjs（新增泄漏判据用例）
- orchestration/orchestrator-tick-core.md（A15 ④ fan-in 序列补 worktree remove）
- plugin/loop/fast-mode-loop-tick.md（A6 与 A15 对齐注明）
- tasks/gap-slot-free-not-an-event-slots-stay-empty-missed-without-trace.md（交叉标注——本因=worktree 泄漏，事件化其后）
- tasks/gap-worktree-leak-after-fan-in-occupies-slot-permanently.md（自身：勾 AC + 贴证据）


> **manager 2026-08-11 05:0x 验证锚补充**：把 git worktree remove 补进 A15 fan-in 序列后，判据是【每次 fan-in 之后 slots-remaining 不下降】；若某轮 fan-in 后它又开始单调下降，说明补的那一步没生效或有别的路径在漏。**这个判据比数 worktree 个数更直接**——它量的正是我们真正在乎的东西（空槽）。

### Finding：验证锚已触发——泄漏复发 + 根因是 subagent prompt 缺 remove（manager 2026-08-11 07:2x，落点 Finding 不进 Contract）

**05:0x 的验证锚在 07:08-07:15 的 7 次 fan-in 后立刻触发**：slots-remaining 从 5 降到 0，`real-in-flight 9 / occupied 9 > cap 5`。**根因（manager 精确指出 + outer 确认）**：`git worktree remove` 在核文档里、**不在实际执行的 fan-in subagent prompt 序列里**——动作在文档、不在执行处 ⇒ 每合一个任务就再漏一个。这正是「文档里写了 ≠ 执行会做」的实例。

**outer 处置（07:2x）**：5 个已合+干净的 worktree（nyf/reconcile-step/serial-install/slot-free/verification-round）目录已被 fan-in subagent 删但留 stale 注册，`git worktree prune` 清掉 ⇒ slots-remaining **0→1**。**4 个不是泄漏**（git-history 未合 / inner-heartbeat / slot-refill-c8 / worktree-leak）：inner 心跳确认 4 subagent 在飞（本任务自己正在修泄漏），realInFlight=4 与心跳一致——删=毁 inner 在飞实现。
**后续**：fan-in subagent 的 prompt 序列必须含 `git worktree remove` + `git worktree prune`（AC3 的落地形式），否则每次 fan-in 复发一次。

### Finding：清理判据的前置依赖——runIds（manager 2026-08-11 07:3x，落点 Finding 不进 Contract）

**「分支已合」是活跃工作期间的瞬时状态，不是「已废弃」的稳定指标。** manager 复核：07:25 判「8 个已合」，outer 说其中 4 个是 inner 在飞；07:30 重跑同一判据——**那 4 个全部显示「未合」**。原因不是读错，是**状态真翻转**：它们的 subagent 在这 5 分钟里提交了新工作，分支重新领先 integration。**任何按祖先关系做 worktree 清理的机制，都会在【fan-in 之后、该 subagent 下一次提交之前】那个窗口里删掉正在使用的 worktree**——今晚实际出现过（07:08-07:15 fan-in 7 条，inner 4 个 subagent 07:17 派、07:2x 才提交，中间几分钟祖先判据下全部像泄漏）。
**两个替代判据也不可靠**：①进程名匹配——subagent 是 `claude` 进程、命令行无任务 id，`ps | grep <task-id>` 恒 0；②`worktreeExists`（fast-mode-telemetry:834/:898）反过来——worktree 在就判存活 ⇒ 泄漏被算成在飞。
**唯一可靠判据 = inner 自己说它在用哪些（inner 心跳的 `runIds`）**。但**心跳字段缩水（gap-inner-heartbeat-fields-shrunk）恰好删掉了 `runIds`**——而 `runIds` 正是这个判别唯一可靠来源。⇒ **`gap-inner-heartbeat-fields-shrunk-no-minimal-contract` 是 worktree 清理机制的前置依赖**：先恢复 `runIds`，再让清理机制读它；在此之前清理只能人工判别、不要机械化。

## Contract
measure   slots_free_after_cleanup = `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slot-status --cap 5 --json` 的 stdout 中 slots-free 数字
band      slots_free_restored = (slots_free_after_cleanup > 0)（泄漏清理后空槽恢复——AC2 引用名）
invariant reconcile_unchanged = 1（--reconcile 只在执行体可观察地消失时关闭——源码已有，不改）
invariant a15_fanin_removes_worktree = 1（outer fan-in 序列含 worktree remove）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slot-status --cap 5 --json`（贴 occupied/slots-free）
control   泄漏清理后空槽恢复；A15 无泄漏累积；reconcile 不变；既有不回归
resume    泄漏清理 / A15 补 remove / 合规产物 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 04:5x 第二次更正（取代 04:42 陈旧括号案）——真因=合并后没删 worktree 的累积泄漏（fast-mode-telemetry:834/:898 判存活=worktree 在）；12 个已合分支 worktree 仍留 ⇒ 每合一个永久吃一槽（occupied 15>cap5）；inner A6 fan-in 有 remove 而 outer A15 没有。outer 复核：清 11 泄漏后 slots-free 0→2。处方：清泄漏 + A15 补 remove + 合规产物。实现归 inner，判定归 outer

> **cross-ref (gap-nyf-branch-existence-vs-commit-trace, 2026-08-11)**：同根形状——拿短暂产物（worktree 存在 / task/<id> 分支存在）当持久事实（执行体存活 / 工作已落地）的信号，短暂产物一消失判据就静默翻转。本任务治「worktree 存在」侧；nyf 任务治「分支存在」侧（nyf 判据换成提交痕迹，不随分支删除失效）。

## Evidence（inner 2026-08-11，实现完成）

**AC1 复现固化**：任务 Proposal 已记录 12 泄漏 worktree 清单 + 单调累积（occupied 15 > cap 5）+ inner A6 有 remove 而 outer A15 没有——复现部分即 Proposal，无需新增。

**AC2 泄漏清理（slots_free_restored 为真）**：对已合分支的泄漏 worktree 跑 `git worktree remove`（安全：分支已合，只删工作副本）。实测清理前后（`--slot-status --cap 5 --json`）：
```
清理前: occupied 9, slots_free 0, real_in_flight 9（9 个已合分支 worktree 的 open bracket 全判存活）
清理后: occupied 4, slots_free 1, real_in_flight 4（slots_free_restored = true）
```
清理的 5 个真泄漏（分支 tip 均为 integration 里真实 `merge: fan-in <task>` 的 parent，树干净，删除无损失）：
`gap-nyf-branch-existence-vs-commit-trace` / `gap-reconcile-step-skipped-no-compliance-product` /
`gap-serial-install-family-shared-prebuilt-fixture` / `gap-slot-free-not-an-event-slots-stay-empty-missed-without-trace` /
`gap-verification-round-missing-phase-ms-breaks-cost-attribution`。
**保留未删**：4 个是 inner 在飞（git-history / inner-heartbeat / slot-refill-c8 / 本任务自身），与 manager 07:2x 心跳 runIds 判别一致——删=毁在飞实现。其中 3 个含未提交工作（slot-refill-c8 的 C8 dispatchGate 实现在 worktree 未提交，任务仍 ready）。

**AC3 A15 fan-in 补 remove**：`orchestration/orchestrator-tick-core.md` A15 ④ fan-in 序列新增 (a1) 步：
`merge --no-ff → --for-task 复测 → git worktree remove → 批量合`，与 inner A6 对齐；`plugin/loop/fast-mode-loop-tick.md`
加 A6/A15 对齐注记。**落地形式（manager 07:2x Finding：动作在文档不在执行处）**：`.claude/workflows/execute-suite-fix.js`
Merge 阶段 prompt 从「验证 worktree 已清理」改为**实际执行** `git worktree remove <verify worktree> && git worktree prune`
（remove 失败标出、不要 --force）——「文档 + 执行处」双落点。
（注：orchestrator-tick-core.md 与 fast-mode-loop-tick.md 均 integration 领先 develop，fan-in 时若 add/add 冲突按 C16 报，未 resolve。）

**AC4 合规产物 + scoped 门**：`--slot-status` 新增 `worktree_leaks` / `worktree_leaks_count` / `worktree_leak_compliant`——
`occupied > cap` 且存在【分支已合但 worktree 仍在】的条目 ⇒ `worktree_leak_compliant=false`（该轮判不合规）；泄漏单独存在或单独超载均判合规。
真实 repo 复测（含 open bracket + 泄漏，occupied>cap 形态）：
```
worktree_leaks_count: 2, real_in_flight: 2, occupied: 2, cap: 1, worktree_leak_compliant: false, slots_free: 0
```
scoped 门（`--for-task`，从 worktree 跑，--allow-thin）：
```
bash scripts/test.sh --for-task gap-worktree-leak-after-fan-in-occupies-slot-permanently --allow-thin
EXIT=0 · tests 62 · pass 62 · fail 0 · cancelled 0
scoped static checks PASS（test-framework-policy / test-isolation / test-impl-census / task-contract / adr016 …）
```
新增 6 用例：detectWorktreeLeaks 纯函数（只报已合并 quay-worktree task 分支 / 无探针 fail-closed / taskIdFromBranch /
isQuayWorktreePath）+ analyzeSlotStatus 合规判定（occupied>cap∧泄漏 ⇒ 不合规；泄漏单独/超载单独均合规）+
CLI real-git 全生命周期（泄漏检出 → worktree remove 清除 → 槽位释放）。

**与 manager 07:3x runIds Finding 的关系（advisory 边界）**：检出器的「分支已合」判据 = 祖先关系，对**在用** worktree
（fan-in 之后、subagent 下次提交之前）有**有界误报**——manager Finding 已实证该窗口真实存在。因此本产物是**报告不是清理器**：
`worktree_leaks` 列候选、`worktree_leak_compliant` 判合规，**永不自动删除**；清理仍按 manager 裁定**人工判别**，直到
`gap-inner-heartbeat-fields-shrunk-no-minimal-contract` 恢复心跳 `runIds` 后机械化。真正防泄漏的是 AC3（fan-in 即 remove），
检出器是兜底信号不是清道夫。

**提交 hash**（develop fork 51885b79 之上，5 步分步提交）：
- bf85d487 合规产物：slot-status 报 worktree-leak ⇒ occupied>cap 判不合规（fast-mode-telemetry.ts）
- 37f00613 测试：worktree-leak 检测与合规判定用例（fast-mode-telemetry.test.mjs）
- 42e8d8db A15 fan-in 补 worktree remove（orchestrator-tick-core.md A15 ④ + fast-mode-loop-tick.md A6/A15 对齐）
- 8c87cb22 检出器 advisory 边界注记（manager 07:3x runIds Finding：报告非清理器）
- 26d6973d A15 ④ workflow Merge 阶段实际执行 worktree remove（AC3 落地形式，execute-suite-fix.js）