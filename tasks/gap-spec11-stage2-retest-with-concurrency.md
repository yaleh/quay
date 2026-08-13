---
id: gap-spec11-stage2-retest-with-concurrency
title: per-task 全量吞吐重测——2-slot 落地后补上停全局轮的唯一前置（QUAY_MAX_CONCURRENT_SUITES 并发，AC3b 门原样搬）
status: ready
labels:
  - gap
  - mechanism
  - milestone-candidate
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**链条断点（manager 2026-08-13 六谓词搜证，试点已 done 但 follow-on 链断）**：
```
2-slot 已合 develop（91327d37，QUAY_MAX_CONCURRENT_SUITES 进代码，7 文件命中）  ✅
      ↓
【用并发 = QUAY_MAX_CONCURRENT_SUITES 重测 per-task 全量吞吐】   ← 本任务承接（此前零任务）
      ↓
吞吐 ≥ 同窗基线 ⇒ AC4：停全局轮 + AC43/AC45 标 cancelled
```

试点 `gap-spec-11-stage-2-per-task-full-suite-pilot` 已 done，closure = **未成立·不可判定**
（AC1 ✅ 4271 tests 绿；并发维度被 single-flight lock 结构性阻塞，机制障碍非方案否证）。
其 follow-on 2-slot（gap-single-flight-lock-2-slot-concurrent-suites）已落地 —— **链条在此断开，
无人承接「用并发重测吞吐」**。本任务补上这一环：**它是停全局轮（AC42 阶段目标翻转）的唯一前置。**

## Plan

1. **前置自检**（对「还有没有第三个串行化者」免疫）：记 AC3b 读数前，确认真有
   `QUAY_MAX_CONCURRENT_SUITES` 个 `scope=worktree` 轮同时 `state=running`；拿不到就不许记
   （否则贴出【串行吞吐】被当并发用——判据前提不成立而输出正常）。
2. **端到端吞吐对照（AC3b 门，从试点原样搬）**：per-task 全量在 `QUAY_MAX_CONCURRENT_SUITES`
   并发下，单位时间合入 develop 的任务数 ≥ **同窗基线**（基线在本次测量窗口重算，非引用历史常量；
   历史读数仅为证明量可测：试点近 6h fan-in 14 任务=2.33/h、全局轮 25 轮占 59% 墙钟、red 19/green 6）。
3. **不设数值阈值**（硬规则 4 推论：成本结构未知前不设阈值——基线是实测不是拍脑袋）。
4. **(b) 单向有效性**：干扰测量只能作「成立」方向证据——达标 ⇒ 可信且比静默窗口更强（被抢时间仍达标）；
   不达标 ⇒ 记为「未定（含干扰）」，**不进 AC4 判定**（干扰本身足以解释，无法区分方案不行与被全局轮压）。
5. **并发度写旋钮名**：`QUAY_MAX_CONCURRENT_SUITES`，不写字面量 2（2 是当前旋钮值，非常量）。
6. **结果路由**：成立 ⇒ 全局轮停跑 + AC43/AC45 标 cancelled；未定（含干扰）⇒ 保持 OPEN，不触发回退。

## Acceptance Criteria

- [ ] AC1 前置自检通过：读数窗口内确有 `QUAY_MAX_CONCURRENT_SUITES` 个 `scope=worktree` 轮同时 running。
- [ ] AC2 端到端吞吐读数贴出：并发 per-task 全量吞吐（单位时间合入 develop 任务数）vs 同窗基线。
- [ ] AC3 单向有效性应用：达标 ⇒ 成立方向证据；不达标 ⇒ 记「未定（含干扰）」不进 AC4。
- [ ] AC4 路由正确：成立 ⇒ 停全局轮 + AC43/AC45 cancelled；未定 ⇒ 保持 OPEN。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 读数 + 结论贴入 `milestones/per-task-full-suite-pilot.md`（续段）或本任务 Evidence。
- [ ] 明确写出「成立 / 未定（含干扰）」之一，不留歧义。
- [ ] AC4 的动作（停轮 + 标 cancelled）或「保持 OPEN」均有记录。

## Touches

- scripts/test.sh（`QUAY_MAX_CONCURRENT_SUITES` 并发读数，如需）
- milestones/per-task-full-suite-pilot.md（续段：重测读数/结论）
- tasks/gap-spec11-stage2-retest-with-concurrency.md（自身）

## Evidence

（落地后回填）
