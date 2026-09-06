---
id: AC-171
title: G2 迁移——当前阶段与下一阶段的 AC 全部成为 store 记录
status: achieved
kind: criterion
goal: GOAL-001
criterion: >
  test "$(node packages/quay/src/goal-store.ts list | grep -c '"id":
  "AC-1[4-6][0-9]"')" -ge 27
expect: exit 0（≥27 条：当前阶段 AC143–155 共 13 条 + 下一阶段 AC156–169 共 14 条）
origin: |
  规格 §7.1：上一次的死因是"建好了没人迁"——goal-store 落地 28 天，goals/ 从未存在。
  ⇒ 迁移排在 ABI 与 driver 之前，让 store 先有真实数据再加功能。
evidence:
  at: 2026-09-06T22:12:13.877Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：`goal-store.ts list` 输出中 `AC-140`…`AC-169` 区间的记录数 ≥ 27。

**取假**：今天必假（`goals/` 目录不存在，list 返回空数组）。
迁移后若漏迁任何一条，计数不足 27 亦判假。

**⚠️ 必须逐条核对，不能按标题范围批量搬**：
`manager-phase-goal.md:12` 当前阶段标题写「AC143–**AC149**」，而该段**实际含到 AC155**
（`39617238e` 追加 AC150-155 时未更新标题）。**这是散文文件不能继续当权威的直接物证。**

**保号迁移**（规格 §2.1）：`AC143` → `AC-143`，数字段不变、不重排、不复用。

**同批产生**：`GOAL-002`（当前阶段「三层塌缩 —— 会话退役，机制承接」，`status: active`）、
`GOAL-003`（下一阶段「插件面收敛 —— 单一 bundle、原生交付、死物归档」，`status: draft`）。
每条 AC 的 `goal:` 指向其一。

**范围限定**：只迁**活跃集 + 下一阶段**（沿用 SPEC-0809 §5 的既有纪律）。
AC1–AC142 的历史阶段留在 `manager-phase-goal.md` / `manager-phase-goal-archive.md` 作历史档案。
