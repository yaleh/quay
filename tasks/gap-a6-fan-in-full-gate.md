---
id: gap-a6-fan-in-full-gate
title: A6 fan-in 门 scoped→full——①b 合并后正确性（跨任务交互）在合并那一刻被抓，停全局轮的前提
status: superseded
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
  superseded: true
  superseded_at: 2026-08-22
  superseded_reason: "核心提案「fan-in 门 scoped→全量」已 moot——fan-in 现在已是全量（fan-in-execute.js SUITE_LAUNCH 跑全量 test.sh），AC126 正改成 --buckets 分桶方向相反。①b 跨任务交互已被分桶阶段更优解接管：AC122（触枢纽⇒全量兜底）+ AC123（跨桶两边）+ AC125（不漏测负控制 3/3）；land 锁子项由 fan-in-ff-merge.sh 现有 merge 锁覆盖"
  superseded_by: "AC122/AC123/AC125"
---

**type:** execution

**PARKED**（2026-08-13，AC4 观察期——①b 已降级为观察项：停轮后若出现「两个各自绿的 merge 组合」追溯红 ⇒ ①b 实证才做本任务；无此形态不补。land 锁/fan-in 升级在观察期证据前不做。）

**①b 观察期账（2026-08-13 第一条真样本，manager 报，方向【支持】停轮）**：停轮前最后一轮全局轮（`scope=main`，16:19:54Z，`full-suite-state` 已定格）是红的——失败对象 `plugin/test/manager-layer-shipping.test.mjs` AC6（manager 建 SPEC-task-status-flow 未登记进 SKILL.md 索引）。全局轮已停 ⇒ 无任何东西会复跑它；按 ①b 论证它会被**下一个 fork develop 的 per-task 全量**抓到（检测延迟真实但有界）。**这是「检测延迟而非漏检」论证的第一次真实样本**：成因属【单任务产物未登记】类（manager 加产物未登记 ⇒ 该层负控制当场变红），**不是**「两个各自绿的 merge 组合互破」形态 ⇒ 不构成 ①b 实证，观察项保持。

## Proposal

**①b 缺口（manager 2026-08-13 自纠）**：AC3b 拆分时 ①「正确性」只证了【单任务】——per-task 全量验「我的分支 + 当时 develop」，不是【合并后】的正确性。A6 fan-in 门是 **scoped**（`tasks/gap-a6-…`：scoped 门在 merge 之前），⇒ 两条任务各自 per-task 全量绿 + scoped 绿，**但合并后在 scoped 范围外互相破坏 ⇒ 当前没有任何东西会抓到**——除了全局轮（它在合并后的 develop 上跑全量）。**停全局轮失去的不是冗余，是【跨任务交互】这一层覆盖。**

**裁定 (A)（outer 2026-08-13，吞吐数据）**：fan-in 门升级为**全量**（worktree 内、merge 之后、push 之前）。
```
现状全局轮：6 轮/h × 全量 7.1min ≈ 43 min/h（共享、阻塞所有等待者）
(A) 每条 merge 全量：28 merges/6h ≈ 4.7/h × 7.1min ≈ 33 min/h（per-task、worktree 内、非阻塞）
(A) 比现状便宜（33 < 43 min/h）且把最后一块共享环节 per-task 化 ⇒ 与本阶段目标一致；①b 在合并那一刻被抓。
(B) 低频全局轮：留下「低频但仍是共享」的东西，下次还要再讨论它什么时候停——不选。
```

**AC4 成立条件改为完整版**：①单任务正确性 ✅ ①b 合并后正确性（本任务落地后 ✅）②并发能力 ✅ ③等待与阻塞 ✅——全满足才停全局轮 + AC43/45 cancelled。

**⚠️ 并发 merge 缺口（manager 2026-08-13 补）**：两条 merge 并发时——A 基于 develop@T0 merge→验绿→push，
B 基于 develop@T0 merge→验绿→push（B 验的树【不含 A 改动】）⇒ 两个都绿、合起来的 develop 从未被整体验过
= ①b 本身。**实测**：integration-batch-merge.sh 无 land 锁（flock/.lock 命中 0）；近 6h fan-in 29 次、
相邻间隔 <10min 有 15 次、最小 32s ⇒ **重叠是常态**（全量要 7.1min）。

**补法**：`merge → 全量 → push` **整体持一把单槽 land 锁**（与套件的 2 槽锁【不是同一把】——2 槽锁管「同时跑几套件」，
land 锁管「同时落几个 merge」）。**代价要说清**：land 锁单槽 ⇒ merge 路径串行化 ≈ 4.7/h × 7.1min ≈ **33 min/h（55%）**
——这是 (A) 的真实成本（比纯 per-merge 多一层「必须串行」），但仍优于现状（43 min/h 共享轮 + merge 本身等待）。
**降成本替代（不牺牲 ①b）**：批量 land——攒 N 个已各自验绿的分支一次 merge 后跑一次全量再 push（N=2 减半），
但引入「谁和谁一批」调度，**现在不做**，仅说明降成本有不牺牲覆盖的路。

## Plan

1. A6 fan-in 门从 scoped 升级为**全量**：`git merge --no-ff` 前在 worktree 内跑全量（`$TEST_COMMAND` 全量，非 scoped）。
2. 全量跑在 worktree（per-task），非主检出（AC42 判据2「测试 cwd 不在主检出」保持）。
3. 负控制：两条各自 per-task 绿但合并后互破的 fixture——(A) 门必须抓到。
4. 吞吐验证：fan-in 门全量后，轮 cadence 不再需要全局轮（或用数据确认 33 vs 43 min/h 节省成立）。

## Acceptance Criteria

- [ ] AC1 A6 fan-in 门在 worktree 内、merge 后 push 前跑**全量**（非 scoped）。
- [ ] AC1b **land 锁（单槽）**：`merge → 全量 → push` 整体持一把单槽 land 锁（与 2 槽套件锁不同把）；
      并发 merge 不绕过它——B 验的树必须含 A 已 push 的改动（①b 在并发下不复现）。
- [ ] AC2 负控制：跨任务交互破坏（各自绿、合并后互破）被 (A) 门抓到（fixture 或真实样例）。
- [ ] AC3 主检出只读保持（AC42 判据2：全量在 worktree 内）。
- [ ] AC4 吞吐：全局轮可停（(A) 承接 ①b 覆盖）；AC4 停轮条件完整。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] fan-in 门全量落地 + 负控制通过。
- [ ] 全局轮停用后 ①b 覆盖不缺失（由 (A) 承接）。
- [ ] AC4 条件完整（① ①b ② ③ 全满足才停轮）。

## Touches

- scripts/ 或 integration-batch-merge 的 A6 fan-in 门（scoped→full）
- plugin/scripts/integration-batch-merge.sh（fan-in 准入全量）
- plugin/test/（负控制 fixture）
- tasks/gap-a6-fan-in-full-gate.md（自身）

## Evidence

（落地后回填）
