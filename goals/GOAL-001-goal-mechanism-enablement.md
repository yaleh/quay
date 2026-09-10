---
id: GOAL-001
title: goal 机制启用与改造——从零使用变成生产使用
status: achieved
kind: goal
origin: |
  人 2026-09-06 四条裁定（goal 优于 milestone / ABI 封装必要 / 暂不自动晋升 /
  接受硬上限+强制关闭，cap=3 stale=7d），规格 orchestration/SPEC-goal-mechanism-2026-09-06.md。
  立条的实测依据：goal-store.ts 于 2026-08-09 落地、功能完整、有测试、有 /goal 路由，
  而 goals/ 目录在任何分支上从未存在过、gate-events 中 "gate":"goal" 零条、落地后 28 天零改动；
  其立案任务 gap-spec-goal-store-third-sibling-kind 标 done 而迁移从未发生。
activatedAt: 2026-09-06
labels:
  - mechanism
  - goal-store
  - bootstrap
---

## 背景

本仓当前有**三个并存的"阶段"候选**，这是人 2026-09-06 提出本轮讨论的直接动机：
①`orchestration/manager-phase-goal.md` 里手写的"本阶段"（3602 行，真正在用，2026-09-05 还改过）；
②`packages/quay/src/goal-store.ts` 的 `PHASE-NNN`/`AC-NNN`（代码完整、**生产零记录**）；
③`docs/` 与 `tasks/` 里散布的 `Phase 1/2/3`（计划内部的次级切分，从属词）。

②的存在本身就是本 GOAL 要解决的问题的证据：**一个建好了、测试绿了、标了 done、
而生产载体一条记录都没有的机制**。它不是设计失败，是**缺强制消费者**——
散文文件继续是权威且编辑它零摩擦，而写 store 要过 fail-closed 校验；
没有任何 driver 读 `goals/`；唯一的机械读者 `goal.phase_ac_checked` 已于 2026-08-14
因「零消费者 + 已知失准」被人令删除。

本 GOAL 要做的不是重建 store，**是把它从零使用变成生产使用**，并按人的四条裁定改造它。

## 范围与非目标

**范围**：`PHASE-NNN → GOAL-NNN` 词表与 id 改造；新增 `draft` 状态；
`I1`（单例 active）→ `I1′`（硬上限 cap）+ `I3`（陈旧三态）+ `I4`（分歧检查）；
当前阶段与下一阶段的 AC 迁入 store；`manager-phase-goal.md` 降级为归档并 repoint 四处 prompt 指针；
goal 由 Core-owned 改为 Provider-backed（ABI 封装）；新增 `goal` driver kind 的机械环与缺口环；
`goal_ac` 任务关联字段；Web dashboard 卡片与 `quay goal` 子命令。

**非目标（明确排除，各自应单独立项）**：
`label:milestone-candidate` 本身的存废（其分类定义仍被 `task check` 每轮执行、
而生产管线自 2026-08-19 停摆，是独立缺陷候选）；`document-store` 的 Core-owned/Provider-backed
归属不一致；`milestones/M<NNN>` 历史目录的清理；GitHub provider 对 goal 的真映射
（本轮只做显式 stub）；把 goal 做成 `role: compound` task（已论证不可行，见规格 §9）。

## 退出条件

散文版：**`manager-phase-goal.md` 不再是任何一层读取"当前该干什么"的来源**，
而 `goals/` 里的记录是；一个常驻 driver 每轮跑 active goal 的 AC 判据并留下带 verdict 的生产记录；
人可以同时激活多条 goal 且被硬上限约束、陈旧的会被报出来；
agent 能经 MCP verb 读到 goal；Web dashboard 上一眼能看到每条 active goal 的 AC 达成率。

机器判据在本 GOAL 的 10 条 AC 记录（`AC-170` … `AC-179`）里，**不在本节**。

## 风险

1. **重演上一次的死法**：实现完但没人迁、没人读。对策是分期顺序把**迁移（G2）与断权威（G3）
   排在 ABI（G5）与 driver（G6）之前**，让 store 先有真实数据再加功能。
2. **AC 编号断裂**：约 20 处生产代码注释与 4 个测试断言 `manager-phase-goal.md` 的 AC 编号，
   迁移必须**保号**（`AC143` → `AC-143`），否则溯源静默失效。
3. **散文文件的范围标注已漂**：当前阶段标题写「AC143–AC149」而该段实际含到 AC155
   ⇒ G2 迁移必须逐条核对，不能按标题范围批量搬。
4. **`cap=3` / `stale=7d` 无成本结构支撑**，是初始策略值；跑满 30 天后须用
   `.quay/goal-round.jsonl` 的真实分布重估并贴回规格 §4.2。
5. **本 GOAL 的记录在 AC-170 达成前机器读不到**（`PHASE_ID_RE` 不匹配 `GOAL-001`），
   这是有意的 bootstrap；但它意味着**在 AC-170 之前本 GOAL 只能人工驱动**。

## 与其他 goal 的关系

`GOAL-001` 与迁移产生的 `GOAL-002`（当前阶段「三层塌缩 —— 会话退役，机制承接」）
**必然同时 active**——**这在旧 `I1`（同一时刻至多一条 active）下是非法的**，
因此 `GOAL-001` 自身就是 `I1 → I1′` 改造的第一个证据，也是它的第一个使用者。

`GOAL-003`（下一阶段「插件面收敛」）迁入时为 `draft`，是 `draft` 状态的第一个真实载体（`AC-172`）。
