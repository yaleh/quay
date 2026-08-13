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

- [x] AC1 前置自检通过：读数窗口内确有 `QUAY_MAX_CONCURRENT_SUITES` 个 `scope=worktree` 轮同时 running。
- [x] AC2 端到端吞吐读数贴出：并发 per-task 全量吞吐（单位时间合入 develop 任务数）vs 同窗基线。
- [x] AC3 单向有效性应用：达标 ⇒ 成立方向证据；不达标 ⇒ 记「未定（含干扰）」不进 AC4。
- [x] AC4 路由正确：成立 ⇒ 停全局轮 + AC43/AC45 cancelled；未定 ⇒ 保持 OPEN。
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 读数 + 结论贴入 `milestones/per-task-full-suite-pilot.md`（续段）或本任务 Evidence。
- [x] 明确写出「成立 / 未定（含干扰）」之一，不留歧义。
- [x] AC4 的动作（停轮 + 标 cancelled）或「保持 OPEN」均有记录。

## Touches

- scripts/test.sh（`QUAY_MAX_CONCURRENT_SUITES` 并发读数，如需）
- milestones/per-task-full-suite-pilot.md（续段：重测读数/结论）
- tasks/gap-spec11-stage2-retest-with-concurrency.md（自身）

## Evidence

**执行：2026-08-13 15:17–15:29（worktree 子代理）。全文在 `milestones/per-task-full-suite-pilot.md` §7。摘要：**

- **AC1 前置自检 ✅**：2 个 scope=worktree 轮同时 `state=running`（Suite A 任务 wt 15:17:40 / Suite B measure-spec11-stage2-b 15:17:43，各 8 lanes），锁日志确认 A 持 `full-suite.lock.0`、B 持 `full-suite.lock.1`（独立槽位非排队）。**1-slot 锁的结构性并发阻塞已被 2-slot 锁移除。**
- **结果**：A **green**（661422ms，4336/0/0）、B **green**（663325ms，4336/0/0）——同 commit 7486cc87 并发全绿。
- **全局轮干扰**：round 164 于 15:18:56 启动，被 2-slot 锁阻塞等待 ~10 min，15:28:42 套件 A 释放后取得 slot .0 正常开跑（**延迟未 abort**）——对照试点 round 150 被 1-slot 锁 abort。
- **吞吐（窗口 15:17:40–15:28:47，0.185h）**：A6 fan-in **0/h** < 同窗基线 2.50–4.83/h（last 2h/4h/6h/8h fresh 重算）⇒ **AC3b 未定（含干扰）**（窗口前 15 min 管道亦 0 fan-in，外生低活动期）。模式 (b) 单向有效性 ⇒ 不进 AC4 判定。
- **AC3 单向有效性**：不达标 ⇒ 未定（含干扰），非成立方向证据亦非不成立。
- **AC4 路由**：未定 ⇒ **保持 OPEN**（不停全局轮，AC43/AC45 不标 cancelled）——本子代理无停轮/标 cancelled 权限，路由作为建议记录。
- **AC5 ✅**：2 套全量 4336/0/0 全绿 + `--for-task gap-spec11-stage2-retest-with-concurrency --allow-thin` scoped 门 exit 0。
- **成立判断**：AC3b 吞吐门【未定（含干扰）】；**机制维度成立**（AC1 + 2 套并发全绿，1-slot 阻塞已除）。停全局轮前提未达成；需管道活跃期/静默窗口（(a) 模式）重测吞吐以定案。
