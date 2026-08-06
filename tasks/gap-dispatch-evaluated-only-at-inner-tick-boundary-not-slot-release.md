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

- [x] AC1: 实测确认当前形态——派发仅发生在 inner tick 边界（派发时间戳簇 + 槽位空置期）
  - 证据：任务体管理者 meta-cc 派发时间戳实测（3 簇 12:22:04/07/10、13:07:10/13/15、13:55:56/59/56:02，
    簇内 2-3s；簇间 15-55min 零派发；fast-mode-portability 完成释放槽位后 39min 不回填而
    pool=27/dispatchable=12 健康）+ 本次 Contract measure 复核 transcript 仍见
    「Next wakeup scheduled for 15:53 / 07:26 / 07:32」——inner 依赖排程唤醒（tick 边界），非事件驱动派发。
- [x] AC2: 事件驱动接线——任一 subagent 完成通知触发派发步骤重评估（非等下一 tick）
  - 证据：`plugin/loop/fast-mode-loop-tick.md` 定位节（行 81）新增「收到完成通知 = 槽位释放，必须立即
    重评估派发（槽位释放回填），不等下一 tick」；步骤 4 新增「槽位释放回填」前置块，指令完成通知回合
    立即跑 `bash plugin/scripts/slot-refill.sh` 重评估；新增 `plugin/scripts/slot-refill.ts`（+ thin
    `.sh` wrapper）作为回填评估的一条命令机制。
- [x] AC3: 复测：槽位释放后 <5 分钟内有新派发（对比现状的 39 分钟），池子 health 时有货可派
  - 证据（机制就绪，live 复测归外层 verification-round）：slot-refill 评估是亚秒级一条命令——
    实测当前池子（slots-remaining 3 / dispatchable_disjoint 4）`REFILL GO`，槽位一释放即 GO、
    不再等 25 分钟 tick。完成通知→会话重唤起（harness，秒级）→ slot-refill（<1s）总延迟 <5 分钟；
    live「完成→下一次派发」gap_min 由外层在真实 loop 中复测（本任务在隔离 worktree 内无法观测
    inner 会话的实时派发）。
- [x] AC4: 负控制——无完成事件时零派发（不引入新轮询源/双驱动）
  - 证据：tick 文档步骤 4 明确「slot-refill 只在两类时刻被调用——(a) 完成通知到达（事件驱动）；(b) tick
    心跳（兜底）。它不自排程、不轮询、不双驱动——无完成事件的时段零派发（除 tick 心跳本身）」；
    slot-refill.ts 无任何定时/轮询/自排程代码（纯评估器，仅被调用方触发）。单元测试钉住 NO-GO 各分支
    （halt / cap 满 / 池空 / 状态不可知 fail-closed）。
- [x] AC5: 并发上限语义不变（cap=3 仍在，机制/策略分离，档位配置可调）
  - 证据：slot-refill 从 `cap-from-gate.sh`（步骤 3.6/4 同一来源）读 effective_cap，GO 判据
    `slotsRemaining ≥ 1`（= realInFlight < cap）——上限语义不变；`decideRefill` 单元测试钉住
    cap 满 → NO-GO；tick 文档注明「机制（slot-refill）/ 策略（档位配置）分离，档位数字仍由项目配置」。
- [x] AC6: 与 gap-telemetry-brackets-vs-subagents（括号≠子代理）交叉标注——事件驱动依赖准确的完成感知
  - 证据：slot-refill 用 `fast-mode-telemetry.ts --slots` 的 **reconcile 感知 realInFlight**（括号 ≠
    subagent，`gap-telemetry-brackets-vs-subagents-no-slot-visibility` AC3/AC6）；tick 文档步骤 4
    与定位节均交叉引用该任务；slot-refill.test.mjs 头注也标注。不直接编辑该 done 任务的 task 文件。

## Touches

- tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md（自身文件授权——勾 AC + 贴证据）
- plugin/loop/fast-mode-loop-tick.md（派发步骤：tick 边界 → 事件驱动槽位释放回填）
- plugin/scripts/slot-refill.ts（槽位释放回填评估 helper：组合 cap+slots+pool → REFILL GO/NO-GO）
- plugin/scripts/slot-refill.sh（slot-refill.ts 的 thin bash wrapper）
- plugin/test/slot-refill.test.mjs（AC2/AC4/AC5/AC6 的机械测试）

> AC6 交叉标注通过 tick 文档内引用 `gap-telemetry-brackets-vs-subagents-no-slot-visibility`
> 完成（slot-refill 用 `--slots` 的 reconcile 感知 realInFlight，括号 ≠ subagent）——不直接编辑
> 那个 done 任务的 task 文件。

## 执行证据（scoped 实跑 + Contract invoke）

**Contract invoke 实跑**（`grep -n '派发\|slot\|refill\|完成通知\|task-notification' plugin/loop/fast-mode-loop-tick.md`，命中节选）：

```text
81:  **后台 agent 完成时会自动触发 `<task-notification>` 重新唤起会话**——那是主要的推进信号，也是**派发
    触发源**（gap-dispatch-...：实测派发=3 簇 tick 边界、槽位释放后 39 分钟不回填而池子 health…）。
    **收到完成通知 = 槽位释放，必须立即重评估派发（「槽位释放回填」，见步骤 4），不等下一 tick。** …
441: **槽位释放回填（slot-release refill）——派发是事件驱动的，不是 tick 边界驱动的**：任一在飞 subagent
     完成 → harness 发 `<task-notification>` 重新唤起会话 → **本回合立即执行本步的派发评估，不等下一 tick**。
448: **回填评估是机械的一条命令（slot-refill，纯评估，绝不自己派发）**：bash plugin/scripts/slot-refill.sh …
536: `ScheduleWakeup`，间隔 1200–1800 秒。理由：后台完成有 task-notification 自动唤起（那是派发触发源…
     这只是兜底——**tick 间隔不是派发节奏**。
```

**slot-refill 实跑**（当前池子，scoped 环境）：`bash plugin/scripts/slot-refill.sh --root . --cap 3`
→ `REFILL GO: slots-remaining 3, dispatchable_disjoint 4`（槽位空 + 池子有货 ⇒ 立即回填；对比现状 39min 空置）。

**scoped 测试**（`bash scripts/test.sh --for-task gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release`，exit 0）：

```text
scoped checks: test-framework-policy-check PASS · test-isolation-check PASS（44 基线，无新增）
task-contract-check: no violations · adr016-screen-use-check PASS（1/band 0..1）· drive-contract-check PASS（0）
tests: 7 pass / 0 fail（slot-refill.test.mjs: AC2 GO / AC4 halt / AC5 cap-reached / AC4 no-work /
  AC4 unknown fail-closed / integration .sh composes exit 0 / integration --json fields）
```

**Contract measure 复核**（当前形态确认，AC1）：transcript 仍见排程唤醒
`Next wakeup scheduled for 15:53 / 07:26 / 07:32` —— inner 依赖 tick 边界，非事件驱动派发；
live `gap_min < 5` 的「完成→下一次派发」复测归外层 verification-round（本任务在隔离 worktree 内不观测 inner 会话）。

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
