---
id: gap-not-yet-flipped-blocks-retreated-ac83-class
title: slot-refill not-yet-flipped 守卫拦 retreat 重派——「AC 全勾 ⇒ work landed」假设对 AC83 类不成立（AC 由 fixture 满足非真实落地），phase-boundary 结构上不可派（outer 19:3xZ 发现）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（not-yet-flipped 守卫拦 retreat 重派——outer 2026-08-14 19:3xZ 发现）**。

**现象**：`gap-phase-boundary-differential-accounting`（ready，AC6 刚补）被 slot-refill 以 `not-yet-flipped` 挡（peer=None）。它原本 done→ready retreat（916e849e：AC83 判据2——5 AC 全勾但生产 0 数据，测试绿靠注入假 cgroup `QUAY_TEST_CGROUP_SCRIPT`，证明能产出非已产出）。

**根因（机械）**：`slot-refill.ts:262 isNotYetFlippedSkip` 判「已 fan-in 待翻 done ⇒ 不重派」当：**(a)** ready-pool excluded 标 not-yet-flipped，或 **(b)** 分支已 merge **且 AC 完成度 >50%**。phase-boundary：分支 merged（640ad48a）+ AC 8/9 勾（含新 AC6 [ ]）= >50% ⇒ 守卫判「work landed，重派只是浪费」⇒ 结构上不可派。

**⇒ 守卫的假设「AC 全勾 ⇒ work landed」对 AC83 类不成立**——AC 由 fixture 满足（注入假 cgroup），非真实落地。这正是 retreat 的原因（测试绿证明「能产出」，不证明「已产出」）。

**与 gap-ready-pool-worklanded-traps-stuck-work 互为镜像**：
```
那条（已落地）：AC 不全 + merged ⇒ 防「AC-incomplete 被当 stuck-work」⇒ AC 不全可派
本条（缺失）：   AC 全勾 + merged + 生产 0 数据 ⇒ 防「fixture 满足的 AC 被当 landed」⇒ AC83 类不可派
```

**后果**：凡 AC83 类任务（implemented-but-no-production-data）retreat 后结构上不可派——必须手动绕过守卫或改代码。phase-boundary 是当前实例（等待 AC83 判据2 的「真实数据落地」）。

**判据1**：retreat（done→ready）的任务，其 AC 若含「读生产载体」类判据（AC83 推论三形式：`载体中满足 X 的记录数 ≥ N，N 在实现落地后时间窗计`），not-yet-flipped 守卫**不得**以「AC 全勾 ⇒ landed」判 skip——生产 0 数据 = 未落地，可派。
**判据2（能取假·真样本现成）**：phase-boundary retreat 后 slot-refill 应报 dispatchable（recommended 含它）；现真值 = not-yet-flipped 挡 ⇒ 假。
**判据3（不破坏既有行为）**：真已 landed 的任务（AC 真实满足、生产有数据）仍被 not-yet-flipped 挡（防重派不回归）；只有「生产载体 0 数据」类解除。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改 AC83 判据本身（生产载体读数是正判据）；不弱化 not-yet-flipped 对真 landed 的防重派（AC3 保证）；不手动绕过守卫（那是本任务要修的机制，不是 workaround）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 slot-refill.ts isNotYetFlippedSkip（:262）+ AC83 判据2 的 retreat 原因（916e849e）+ phase-boundary AC 结构（8/9 勾，含读生产载体的判据）。
2. 判据1：not-yet-flipped 对「AC 含读生产载体类判据 + 生产 0 数据」不判 skip（可派）。
3. 判据2 能取假：phase-boundary retreat 后 recommended 含它（现 not-yet-flipped 挡）。
4. 判据3：真 landed（生产有数据）仍被挡（防重派不回归）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：not-yet-flipped 对 AC83 类（AC 含读生产载体 + 生产 0 数据）不判 skip。
- [ ] AC2 判据2 能取假：phase-boundary retreat 后 slot-refill recommended 含它（现 not-yet-flipped）。
- [ ] AC3 判据3：真 landed 任务仍被挡（防重派不回归）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] not-yet-flipped 守卫对 AC83 类（fixture 满足的 AC + 生产 0 数据）放行重派 + 真 landed 仍挡 + 测试绿。

## Touches

- plugin/scripts/slot-refill.ts（isNotYetFlippedSkip：AC83 类不判 skip——读生产载体判据 + 生产数据为空 ⇒ 可派）
- plugin/test/slot-refill.test.mjs（补测：AC83 类 retreat 可派 / 真 landed 仍挡）
- tasks/gap-phase-boundary-differential-accounting.md（自身——落地后 phase-boundary 可派，即本任务验收）
- tasks/gap-not-yet-flipped-blocks-retreated-ac83-class.md（自身）

## Evidence

（落地后回填——outer 2026-08-14 19:3xZ：slot-refill 对 phase-boundary 报 deferred reason=`not-yet-flipped`，peer=None；916e849e 记录 retreat 原因（5 AC 全勾但生产 0 数据））
