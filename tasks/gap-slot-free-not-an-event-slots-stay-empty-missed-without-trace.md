---
id: gap-slot-free-not-an-event-slots-stay-empty-missed-without-trace
title: "空槽不是事件 ⇒ 槽位空闲 4、可派 11 却漏回填——「in_flight<cap ∧ dispatchable>0」只靠三层 20-25 分钟 tick 轮询，醒来时手上总有更急的事（红套件/fan-in/needs-human）⇒ 回填空槽永远排最后且漏了不留痕；既有 gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release 假设缺触发器，实测触发器存在（task-notification 唤醒）但醒来第一件事是 fan-in+报告不是 A11/A12/A13+回填；处方=按 suite-state-trigger 模型做 slot-free 事件推送"
status: todo
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

**空槽不是事件 ⇒ 槽位空闲 4、可派 11 却漏回填。`in_flight < cap ∧ dispatchable > 0` 目前只靠三层 20-25 分钟 tick 轮询到那一格才处置；而 tick 醒来时手上永远有看起来更急的事（红套件 / fan-in 冲突 / needs-human），回填空槽永远排在最后，且漏了不留痕（C17 形状：守与不守在记录上不可区分）。**

### 实证（manager 2026-08-11 04:2x 现场读数 + outer 复核）

- **现场读数**：inner 心跳 `effectiveCap=5`、runIds 只有 1 条（resource-gate-psi）⇒ 在飞 1、**空槽 4**；`ready-pool-check --cap 5` 报 `pool=20 dispatchable_disjoint=11 deficit=0`；`budgetHit=False`、`agentDispatches=18/200` ⇒ **不是 subagent 预算触顶**（CLAUDE.md「先查 subagent 预算」已查，排除）。
- **inner delaySeconds=1500** ⇒ 每 25 分钟醒一次；心跳距今 843s ⇒ 下次自评估还要 11 分钟。
- **既有任务假设被证伪**：`gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release`（status:ready, 11/12 AC，唯一未勾 AC3=槽位释放后 <5min 派发）假设缺「槽位释放触发器」——**触发器存在**：harness 在 agent 完成时用 task-notification 唤醒 inner，inner 13:1x 报告标题就写着「task-notification 触发」。问题是它把这次唤醒用来做 fan-in 和写报告，**没有回填**：那轮报告里 A11(ready-pool-check --apply) / A12(slot-refill) / A13(slots 遥测) 三条【必跑】一条读数都没有。
- **缺的不是触发器，是【醒来后的第一件事】**。
- **fast-mode B3 自己写着**「tick 是兜底心跳，不是派发节奏」（fast-mode-loop-tick.md:792「完成通知就是派发触发器；tick 心跳只是兜底」）——**设计意图早就对了**，但没有任何产物能区分【守】与【不守】（C17 形状）。
- **唯一从不漏发的信号源是 monitor 事件**：它被推过来、不依赖谁记得去读；三层 tick 都是 20-25 分钟定时器。
- **与人的层级裁定一致**：每层不自诊自身失能，由上一层观察处置；outer B3 甲职责已存在——缺的是让甲由**事件驱动**，而非等 20 分钟 tick 转到那一格。

### 选定机制方向（实现归 inner，判定归 outer）

**按 `suite-state-trigger.ts` 的模型，把「in_flight<cap ∧ dispatchable>0」做成事件推送**：
1. **slot-free-trigger**（照 suite-state-trigger 形态）：Monitor 轮询（~5s）读 ready-pool-check/slot-refill + inner 心跳 runIds，`in_flight < cap ∧ dispatchable > 0` ⇒ 发 `SLOT-FREE` 事件 + 追加 `.quay/slot-free-events.jsonl`。
2. **outer 接事件**：`SLOT-FREE` ⇒ 立即驱动 inner 回填（不等 20-min tick）——事件日志把「事件已发但没回填」变成可追责记录（C17 闭合：漏了留痕）。
3. **inner 醒来第一件事**：task-notification 唤醒后**先跑 A11/A12/A13 三条必读 + 回填**，再做 fan-in/写报告（把 13:1x 那次「三条必读零读数」的次序纠正过来）。
4. **既有任务收口**：gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release 的 AC3 复测改判据——从「槽位释放触发器」改为「醒来第一件事回填」（触发器已存在，证伪原假设）。

**验证锚**：修后 (a) `in_flight<cap ∧ dd>0` 时 slot-free-trigger 发事件（贴 `.quay/slot-free-events.jsonl`）；(b) 事件后 outer 立即驱动内层回填（事件 → 驱动时间戳 < 5min）；(c) inner 醒来第一件事含 A11/A12/A13 读数 + 回填；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录现场读数（在飞 1/空槽 4/可派 11/budgetHit=False）+ task-notification 触发器存在但醒来做 fan-in 不回填 + 三条必读零读数（本任务 Proposal 已含）
- [ ] AC2: **slot-free-trigger**——`in_flight<cap ∧ dispatchable>0` 发 `SLOT-FREE` 事件（照 suite-state-trigger 模型，Monitor 推送 + events.jsonl）
- [ ] AC3: **outer 接事件回填**——`SLOT-FREE` ⇒ 立即驱动 inner 回填（事件→驱动 < 5min）；漏回填在事件日志可追责
- [ ] AC4: **inner 醒来第一件事**——task-notification 唤醒先跑 A11/A12/A13 + 回填，再做 fan-in/报告
- [ ] AC5: **既有收口 + 不回归**——gap-dispatch-evaluated AC3 判据改「醒来第一件事」；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：构造 `in_flight<cap ∧ dd>0` ⇒ SLOT-FREE 事件 + outer 立即驱动（贴事件日志 + 时间戳）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/slot-free-trigger.ts（新事件触发器，照 suite-state-trigger 形态）
- plugin/scripts/suite-state-trigger.ts（参考/复用模式）
- .quay/slot-free-events.jsonl（事件日志，append-only，gitignore）
- plugin/loop/fast-mode-loop-tick.md（inner 醒来第一件事：A11/A12/A13 + 回填）
- plugin/loop/orchestrator-loop-tick.md（outer 接 SLOT-FREE 立即驱动）
- orchestration/orchestrator-tick-core.md（A18/B9 空槽强制链加事件驱动分支）
- tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md（AC3 判据改正：触发器存在，醒来第一件事）
- tasks/gap-slot-free-not-an-event-slots-stay-empty-missed-without-trace.md（自身：勾 AC + 贴证据）

## Contract

measure   slot_free_event_fired = `tail -1 .quay/slot-free-events.jsonl` 的 stdout 中是否含 SLOT-FREE
band      slot_free_event_fired = 构造 in_flight<cap ∧ dd>0 场景后事件在场
invariant event_to_drive_under_5min = 1（SLOT-FREE 事件 → outer 驱动 inner < 5min）
invariant inner_wake_reads_a11_a12_a13 = 1（task-notification 唤醒后 A11/A12/A13 三条必读 + 回填）
invoke    `tail -3 .quay/slot-free-events.jsonl`（贴 SLOT-FREE 事件 + 时间戳）
control   空槽发事件；事件即驱动；醒来先读三条必读；漏回填留痕
resume    trigger / outer 接线 / inner 第一件事 / 既有收口分步提交，任一步完成即写盘

> **manager 2026-08-11 04:4x 更正（取代原案优先级）**：空槽问题真根因=槽位账本失真（27 陈旧遥测括号 ⇒ slots-free 0），非节律/非触发器方向；inner 完全按 C6 规矩办事（closedButLive 仍占槽 ⇒ slots-remaining 0 ⇒ 不多派），不是漏派。缺的下一步写在 inner 自己核 A13「stale_brackets > 0 ⇒ 调 --reconcile」，它看见了没执行。**事件化方向仍值得做，但优先级在【A13 --reconcile 步骤被跳过】之后**——后者是直接损失 4 槽×多轮的原因，同为 C17 形状。本任务保留为事件化方向（照 suite-state-trigger），优先级下调；对账问题另立任务。

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 04:2x 现场读数——空槽 4 可派 11 漏回填；既有任务假设「缺触发器」被证伪（task-notification 存在但醒来做 fan-in 不回填）；fast-mode B3:792 设计意图已对但无产物区分守与不守（C17）。处方：按 suite-state-trigger 模型做 slot-free 事件推送 + inner 醒来第一件事。实现归 inner，判定归 outer
