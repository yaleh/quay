---
id: gap-inner-self-wake-sleep-empty-slots-not-dispatch
title: inner 满池自选长睡——空槽+池有货+不派的第三种成因（决策依据与结果分记录 / 有货可派不结束一轮）
status: todo
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**第三种成因（人 2026-08-13 裁定 AC53，与 CLAUDE.md 已记两种都不同）**：空槽+池有货+不派，
不是 subagent 预算触顶，也不是 inner 占回合做主线程编辑，而是 **inner 在满池状态下自选长睡**。

**实测（04:08Z 三读数同时取）**：
```
A9 判据       : suite state=running ⇒ 落在【照常派发】支
slot-refill   : should_refill=True  no_refill_reason=None
                slots_free=5  dispatchable_disjoint=5  pool=16  in_flight_count=0
                landing_blocked=False  suite_blocking.window_active=False
心跳          : ts=04:02:52Z  delaySeconds=1500  runIds=[]
                reason="ALL tasks landed, 0 in-flight; sync pushed"
```
**自锁形状**：0 在飞 ⇒ 无完成事件 ⇒ 唯一唤醒源只剩 25 分钟心跳 ⇒ 继续 0 在飞。
**醒 ≠ 派**：04:02 那一轮「醒着、5 空槽、5 可派、然后自选睡 25 分钟」——同一决策在 04:27 复现。
25 分钟不是实际地板：实测 slot-refill 调用间 4 段 54-149 分钟空档、合计占 12h 窗口 52%。

**自举陷阱**：修本任务的工作会被本任务描述的缺陷本身推迟 ⇒ 必须外力打破
（人 04:2xZ 直接指示 outer 显式驱动 inner）。**已实证**：04:23Z SendMessage 直接驱动 ⇒
inner 立即派发 per-run namespace（驱动前 0 在飞 25min+、驱动后立即派）——AC53 负控制的第三实证。

## 判据四条（正本 orchestration/manager-phase-goal.md AC53）

1. **结束条件不变式（无例外形）**：一轮 tick 不得在
   `should_refill ∧ slots_free>0 ∧ dispatchable_disjoint>0 ∧ no_refill_reason 为空` 下结束。
   要么继续派发直到其中一项为假，要么写出一个 no_refill_reason。
   刻意不设「延迟超过 N 秒才算异常」的数值阈值——那是「多长算长」的裁量。
2. **决策依据与决策结果同条记录**：心跳在选定 delaySeconds 的那一刻落盘
   `slots_free / dispatchable_disjoint / pool / should_refill / no_refill_reason`。
   现状这五个键全部缺席 ⇒ 记录结构上分不清「没货可派」与「有货不派」。
3. **可回看**：心跳改追加式 jsonl，不再单槽快照。
4. **⭐ 负控制**：把 04:02:52Z 真实心跳连同同时刻 slot-refill 读数回放进判据 1，必须报红。
   从未在真实历史样本上亮过红的判据不算判据（AC50 判据2 恒真教训）。
   **第二真实样本（04:22Z）**：inner idle 19min / should_refill=true / slots_free=5 / in-flight=0 /
   pool=20=floor——与第一样本成对，修后「不再复现」有对照。

**两点明确纳入**：
- AC42-52 不修这条——per-task 验证改的是「验证在哪跑」，不是「谁叫醒派发」；自锁在新模型下一模一样。
- 新模型会让它更痛：锁容量 2 vs 槽位 5 ⇒ 吞吐从槽位受限变成锁受限，且每任务多背 ~450s 套件。

**同族（不进本 AC 验收面）**：今晚三个「自己决定何时再醒」的机件里两个同形失效——
轮终等待器（退出条件是被覆盖的 runId，结构上不可能成立）已清理；suite-state-trigger 未查。

## AC

- [ ] AC1: 心跳在选 delaySeconds 时刻落盘五键（slots_free/dispatchable_disjoint/pool/should_refill/no_refill_reason）
- [ ] AC2: 结束不变式——有货可派不得结束一轮（除非写出 no_refill_reason）
- [ ] AC3: 心跳改追加式 jsonl（可回看）
- [ ] AC4: 负控制——回放 04:02:52Z 真心跳+slot-refill 必须报红
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 负控制样例贴出（04:02:52Z + 04:22Z 两样本回放报红）
- [ ] 全量套件绿

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（或 inner 心跳写入方——五键落盘 + 追加式 jsonl）
- plugin/scripts/slot-refill.ts（如需）
- tasks/gap-inner-self-wake-sleep-empty-slots-not-dispatch.md（自身）
