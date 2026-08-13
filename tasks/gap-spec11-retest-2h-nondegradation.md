---
id: gap-spec11-retest-2h-nondegradation
title: per-task 全量吞吐 ≥2h 不劣化重测——AC3b 门定死后停全局轮的最后一步
status: ready
labels:
  - gap
  - mechanism
  - milestone-candidate
parent: null
children: []
depends_on:
  - gap-spec11-stage2-retest-with-concurrency
extra:
  schema: execution
---

**type:** execution

## Proposal

**链条最后一步（manager 2026-08-13 裁定：机制维度已证明，剩下的全部障碍是测量设计；定死门 + 跑 ≥2h 窗口，AC4 就能判）**：

```
机制维度已成立：2 套 scope=worktree 全量并发全绿（2-slot 锁移除结构性并发阻塞）  ✅
      ↓
【≥2h 不劣化重测】（本任务承接）   ← AC3b 门定死后最后一步
      ↓
不劣化成立 ⇒ AC4：停全局轮 + AC43/AC45 cancelled；未定 ⇒ 保持 OPEN
```

首测（`gap-spec11-stage2-retest-with-concurrency`，ab5b8f1a）窗口 11min ⇒ **期望计数 0.46–0.89 < 1 ⇒ 观测 0 零信息**（与方案好坏都一致），记「未定（含干扰）」。AC3b 门已修正为**不劣化设计**（同窗重算作废=自指恒等；纯对照组不存在——per-task 已跑+全局轮在跑，before/after 只能是「停全局轮后 vs 前」而停轮正是待证结论）。

## Plan

1. **窗口 ≥2h**（按当前速率 2.5–3.3/h ⇒ 期望 5–7 个 fan-in >1，最小窗口条件满足）。
2. **不劣化门**：本窗口 fan-in/h ≥ **紧邻的前一个同长度窗口**的 fan-in/h（同长度+紧邻，否则速率 2.5–5.17/h 波动 2 倍使窗口选择决定结论）。
3. **两窗口污染状态都贴**：全局轮轮数、是否含集中 closure。
4. **前置自检**：记读数前确认真有 `QUAY_MAX_CONCURRENT_SUITES` 个 `scope=worktree` 轮同时 running。
5. **单向有效性**：不达标 ⇒ 记「未定」，不进 AC4（干扰本身足以解释）。
6. **结果路由**：不劣化成立 ⇒ 停全局轮 + AC43/AC45 cancelled；未定 ⇒ 保持 OPEN。

## Acceptance Criteria

- [ ] AC1 窗口 ≥2h 且前置自检通过（S 个 scope=worktree 轮同时 running）。
- [ ] AC2 不劣化读数贴出：本窗口 vs 紧邻前同长度窗口的 fan-in/h + 各自污染状态。
- [ ] AC3 单向有效性应用：不达标 ⇒ 记「未定」不进 AC4。
- [ ] AC4 路由正确：成立 ⇒ 停全局轮 + AC43/AC45 cancelled；未定 ⇒ 保持 OPEN。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 读数 + 结论贴入 `milestones/per-task-full-suite-pilot.md`（续段）。
- [ ] 明确写出「不劣化成立 / 未定」之一。
- [ ] AC4 动作或「保持 OPEN」有记录。

## Touches

- milestones/per-task-full-suite-pilot.md（续段读数）
- tasks/gap-spec11-retest-2h-nondegradation.md（自身）

## Evidence

（落地后回填）
