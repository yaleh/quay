---
id: gap-not-yet-flipped-blocks-retreated-ac83-class
title: retreat 只退 status 不退 AC 勾选——not-yet-flipped 把退回任务判成 landed（phase-boundary AC 89% 声称完成、实质 ≈11%；manager 20:0xZ 裁定根因在 retreat 不在 gate）
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

**（retreat 应同时退 AC 勾选——manager 2026-08-14 20:0xZ 裁定，根因不在 gate）**。

**现象**：`gap-phase-boundary-differential-accounting`（retreat 回 ready）被 slot-refill 以 `not-yet-flipped` 挡（peer=None），结构上不可派。

**根因（manager 20:0xZ，正确归因——不是 gate）**：`isNotYetFlippedSkip`（slot-refill.ts:262）判「merged + AC>50% ⇒ landed ⇒ 不重派」。phase-boundary：分支 merged（640ad48a）+ **AC 8/9 勾（89%）> 50%** ⇒ 守卫判它 landed——**在它自己的规则下这是对的**（89% 确实 >50%）。

**真缺口在 retreat 操作**：
```
AC83 的整个意思：AC1-4 是被 QUAY_TEST_CGROUP_SCRIPT 注入的假 cgroup 满足的，生产载体 164 轮 cpu_usec/psi 命中 0
⇒ 它们【本来就不该算满足】
⇒ 但 retreat（done→ready，916e849e）只退了 status，没退那 4 个勾
⇒ 任务体自己在说「我 89% 做完了」，实质完成度 ≈11%
```

**⛔ 已否决的方案（outer 19:3xZ 原判据1，manager 20:0xZ 驳回）**：让 not-yet-flipped 对「AC83 类」放行——那是给 gate 开【按任务类别】的例外通道；「哪些任务属于 AC83 类」无机械判据 ⇒ 例外通道靠人判 ⇒ 会漂（今天已见「恒红归档已知家族」的代价，例外通道是它的镜像）。

**✅ 采纳方案**：**retreat 操作应同时退 AC 勾选**（或至少标记「待重验」），否则 not-yet-flipped 会把退回的任务判成 landed。
```
⊢ 现状反例（能取假）：phase-boundary status=ready 而 AC 89% ⇒ 该状态组合不该存在
⊢ 修后形态：retreat 后 AC 11%（1/9，AC5 真值保留）⇒ not-yet-flipped 自然放行 ⇒ 无需改 gate
```

**⚠️ 写法约束（manager 20:1xZ，第 5 条实例）**：目录级 `plugin/test/` 在【持续产生】——今天刚清 4 条（a6/anti-drift/ff-livelock/suite-budget），本任务原本又带同写法（第 5 条）。**收窄存量不解决它**：只要新任务继续这么写，互锁环就不断重建。**立案时不得用目录级 `plugin/test/`，写具体测试文件**（本任务 Touches 已收窄为 `plugin/test/retreat-ac-uncheck.test.mjs`）。⛔ 不造检查器（发生率已 5 但立案是手工动作，一条约束比一个检查器便宜）。

**判据1**：**retreat（done→ready）操作同时退 AC 勾选**——被 retreat 的任务 AC 完成度应反映实质（fixture 满足的判据不勾），不得带着旧完成度进入下一轮判定。
**判据2（能取假·真样本现成）**：`phase-boundary` 现 status=ready 而 AC 89% ⇒ 该状态组合不该存在；修后 retreat 即退勾 ⇒ ready + AC 11%。**已被外层 8e502922 手工退勾（本任务的 fallback），机制落地后自动发生**。
**判据3（不削弱真 landed 防重派）**：真 landed（生产有数据、AC 真实满足）的 done 任务不受影响——retreat 只影响退回的任务。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改 isNotYetFlippedSkip 的判定逻辑（89%>50% 判 landed 是对的）；不造「AC83 类」例外通道（已否决）；不手动绕过守卫（那是 workaround，本任务修的是 retreat 语义本身）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 retreat 路径（lifecycle/retreat 的实现——done→ready 只写 status 不碰 body AC 段）。
2. 判据1：retreat 同时退 AC 勾选（或标记待重验）。
3. 判据2 能取假：phase-boundary 状态组合（ready + AC 89%）不该存在；机制落地后 retreat 即退勾。
4. 判据3：真 landed done 任务不受影响。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：retreat（done→ready）同时退 AC 勾选（或标记待重验），不带旧完成度进下一轮。
- [ ] AC2 判据2 能取假：phase-boundary 现 ready + AC 89%（8/9）状态组合不该存在；修后 retreat 即退勾。
- [ ] AC3 判据3：真 landed（生产有数据）done 任务不受影响（防重派不回归）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] retreat 同时退 AC 勾选（fixture 满足的判据不勾）+ 真 landed 不受影响 + 测试绿。

## Touches

- packages/quay/src/gate/lifecycle.ts 或 retreat 实现处（retreat 同时退 AC 勾选 / 标记待重验）
- plugin/test/retreat-ac-uncheck.test.mjs (new，**收窄为具体文件**——⛔ 不用目录级 plugin/test/，避免再次重建互锁环；补测：retreat 后 AC 完成度反映实质；真 landed 不受影响)
- tasks/gap-not-yet-flipped-blocks-retreated-ac83-class.md（自身）

## Evidence

（落地后回填——outer 2026-08-14 19:3xZ：slot-refill 对 phase-boundary 报 not-yet-flipped；manager 20:0xZ 裁定根因在 retreat 非 gate；8e502922 手工退勾 AC1-4（AC5 保留）后 phase-boundary 可派）
