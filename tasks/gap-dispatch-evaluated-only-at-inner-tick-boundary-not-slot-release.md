---
id: gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release
title: "dispatch re-evaluated ONLY at inner's own tick boundary, not at slot
  release — measured (manager meta-cc, 2026-08-05): 20 Agent dispatch
  timestamps over 6h = 3 tight clusters (12:22:04/07/10, 13:07:10/13/15,
  13:55:56/59/56:02, intra-cluster 2-3s) with 15-55min ZERO-dispatch gaps
  (39/30/18/33/50); fast-mode-portability dispatched 12:22:04 done ~12:28
  freed a slot, next dispatch 13:07:10 = 39min idle while pool=27 /
  dispatchable_disjoint=12 healthy; inner pane self-reports '下一 tick 排定
  20/25分钟后' + transcript 'Next wakeup scheduled... harness re-invokes on
  wakeup or task-notification' → design intent '并发是打破外层变瓶颈' (fast-mode-
  loop-tick.md) is DEGRADED: inner's own tick interval replaces the outer's
  20min, slot idle ≈ tick period, bottleneck moved from outer to inner;
  ~170min recoverable throughput across the sample window; fix direction:
  event-driven re-evaluation when ANY in-flight subagent completes (completion
  notification already exists in the two-layer protocol), not tick-polling;
  investigate whether the task-notification turn currently re-runs the dispatch
  step"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**派发只在 inner 自己的 tick 边界评估，槽位释放不触发回填——管理者 meta-cc 实测，撤回早前「滚动派发」结论**：

**【实测证据（meta-cc 派发时间戳，非 git 提交时间）】**：
1. 近 6h 20 次真实 Agent 派发，时间分布 = **3 个紧密簇**（12:22:04/07/10、13:07:10/13/15、
   13:55:56/59/56:02，簇内间隔 2-3 秒），簇与簇之间 **15-55 分钟零派发空档**（39/30/18/33/50 分钟）。
2. **关键检验——槽位提前释放后未立即回填**：fast-mode-portability 12:22:04 派发、~12:28 完成
   （6 分钟）释放 1 槽位，下一次派发是 13:07:10——**该槽位空置 39 分钟**，同期就绪池
   pool=27 / dispatchable_disjoint=12（12 个互不相交候选，不是没活干）。
3. **inner 自白**：pane 显示「下一 tick 排定 20/25 分钟后（1200s/1500s 兜底）」；transcript
   「Next wakeup scheduled for 15:53/16:02/16:10/16:26/16:38… harness re-invokes when the wakeup
   fires or a task-notification arrives」。

**【与设计意图的直接矛盾】**：fast-mode-loop-tick.md 原话「并发是打破外层变瓶颈的手段——串行时外层的
20 分钟 tick 频率会和任务完成频率同量级，分层退化成单层加延迟」。当前实现正是文档警告的退化形态：
**inner 自己的 tick 间隔（20-25 分钟）取代了外层的 20 分钟**，槽位空闲时间与 tick 周期同量级——
瓶颈从外层搬到了 inner 自己身上。

**【量化损失】**：3 簇共派发 9 个任务，簇间空档合计约 170 分钟（39+30+18+33+50，样本内）；期间池子
健康有货可派，至少 1-2 个槽位闲置，是可回收的吞吐。

**【此前误判的过程（方法教训）】**：先以「完成时长不同（6-68min）」判为滚动派发——错误，那只证明任务
耗时不同；正确判据是**派发事件的时间分布**。此判据本身也印证了「历史过程类问题用 meta-cc 派发时间戳、
不用 git 提交时间重建」的规则。

### 选定机制

1. 派发决策改为**事件驱动**：任一在飞 subagent 完成的那一刻立即重评估「槽位+候选」是否可派
2. 先调查：完成通知（task-notification）到达后 inner 的回合是否重跑了派发步骤——若没有，接线
3. 若事件驱动实现复杂，退路：inner tick 间隔内嵌短周期轮询（如每 5 分钟），且轮询仅评估派发不调度

## Acceptance Criteria

- [ ] AC1: 实测确认当前形态——派发仅发生在 inner tick 边界（派发时间戳簇 + 槽位空置期）
- [ ] AC2: 事件驱动接线——任一 subagent 完成通知触发派发步骤重评估（非等下一 tick）
- [ ] AC3: 复测：槽位释放后 <5 分钟内有新派发（对比现状的 39 分钟），池子 health 时有货可派
- [ ] AC4: 负控制——无完成事件时零派发（不引入新轮询源/双驱动）
- [ ] AC5: 并发上限语义不变（cap=3 仍在，机制/策略分离，档位配置可调）
- [ ] AC6: 与 gap-telemetry-brackets-vs-subagents（括号≠子代理）交叉标注——事件驱动依赖准确的完成感知

## Touches

- tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md
- plugin/loop/fast-mode-loop-tick.md（派发步骤：tick 边界 → 事件驱动）
- plugin/scripts/（若有派发评估 helper：slot-refill.ts 或类似）
- tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md（AC6 交叉标注）

## Contract

measure   gap_min = `grep -oE "Next wakeup scheduled for [0-9:]+" ~/.claude/projects/-home-yale-work-quay/c7b58e09-b54d-4ffc-a7f7-4863f2b854cd.jsonl | tail -1` stdout 数字段（复测「完成→下一次派发」间隔，实跑输出贴任务体）
band      gap_min = < 5（对比现状实测 39 分钟）
invoke    `grep -n '派发\|slot\|refill\|完成通知\|task-notification' plugin/loop/fast-mode-loop-tick.md`
control   无完成事件时段零派发（AC4 负控制）
resume    调查与接线分步提交：先证明完成通知是否触发重评估，再接线

## Dispatch review

reviewer: outer
at: 2026-08-05T18:2xZ
changed: 外层 filing 时已审（ratchet compliance 补齐 section）
