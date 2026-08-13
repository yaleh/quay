---
id: gap-ac53-end-invariant-gate
title: AC53 判据①机械执行——结束不变式的结构性闸（无合法退出路径）
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

**实证（2026-08-13，第 7 次同形）**：AC53 已立（gap-inner-self-wake-sleep-empty-slots-not-dispatch，
AC1-7 全勾），但「有货可派 + 无理由时不能结束一轮」的**判据①仍未机械拦截**——本轮我又在
`should_refill=true ∧ slots_free=5 ∧ dispatchable>0 ∧ no_refill_reason=null` 下写「awaiting next
dispatch」reason 然后睡。**第 7 次同形证明：记录/措辞/更详细的 reason 都拦不住——形态必须是
「结构性做不到」，不是「写得更好」。**

**根因**：tick 执行核 A12 只**记录**结束不变式（写 reason），B3（ScheduleWakeup/sleep）是**合法退出
路径**——无论 should_refill 是否 true 都能睡。AC53 的 judgeEndInvariant 是 checker（事后读心跳报红），
不是 gate（事前拦 sleep）。

**修法（结构性闸）**：**调度层/心跳写入层在 `should_refill=true ∧ slots_free>0 ∧ dispatchable>0 ∧
no_refill_reason 空` 时【没有合法退出路径】**：
1. 心跳写入方（inner-wakeup-heartbeat.ts）在写结束心跳前**用直接量重跑 slot-refill**（不读心跳自述，
   判据②已落）——若 `should_refill ∧ slots_free>0 ∧ dispatchable>0 ∧ no_refill_reason 空` ⇒
   **写拒绝心跳**（exit 非 0，reason=end-invariant-violated），调度层必须回派发。
2. tick 执行核 B3 加一句：心跳写失败（end-invariant 违例）⇒ **不得重排 sleep**，回步骤 4 派发。

**验收 = 第 7 次同形回放必须被拦截**（类似 AC53 负控制）：构造「should_refill=true + slots_free=5 +
dispatchable=10 + no_refill_reason 空」的写心跳调用 ⇒ 必须 exit 非 0 拒绝写入，不是写个 reason 就过。

## Plan

1. `plugin/scripts/inner-wakeup-heartbeat.ts`：写结束心跳前调 slot-refill 直接量（--in-flight 本会话在飞），
   判结束不变式；违例 ⇒ 拒绝写入 + exit 非 0（reason=end-invariant-violated）。
2. `orchestration/fast-mode-tick-core.md` B3：心跳写失败（end-invariant 违例）⇒ 不得重排 sleep，回派发。
3. 测试：第 7 次同形回放（should_refill=true + 空 reason + 有货）⇒ 写拒绝 exit 非 0。
4. scoped 门绿 + 下轮验证（不再出现「有货可派+无理由睡觉」的同形轮）。

## AC

- [x] AC1: 写结束心跳时用直接量重跑 slot-refill，判结束不变式
- [x] AC2: 违例（should_refill ∧ slots_free>0 ∧ dispatchable>0 ∧ reason 空）⇒ 拒绝写入 + exit 非 0
- [x] AC3: tick 执行核 B3：心跳写失败 ⇒ 不得重排 sleep，回派发（无合法退出路径）
- [x] AC4: 第 7 次同形回放（真实负控制）被拦截
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿（零并发约束下已跑受影响三测试文件全绿；scoped 门延至绿灯窗）
- [ ] AC6: 下轮验证——不再出现「有货可派+无理由睡觉」同形轮

## Definition of Done

- [ ] AC1–AC6 全部勾上（AC5/AC6 待绿灯窗验证）
- [x] 第 7 次同形回放拒绝实测贴出
- [ ] 既有测试全绿（`--for-task` scoped，延至绿灯窗）

## Evidence（2026-08-13 实施）

**第 7 次同形回放（真实负控制）被结构性拦截——writer REFUSED, exit=1, nothing written**：

```
slot-refill exit= 0
should_refill= true slots_free= 5 dd= 1 recommended= ["gap-fixture-dispatchable"]
writer exit= 1
stderr: inner-wakeup-heartbeat: REFUSED — 结束不变式违例，不写入（reason=inner-round-ended-with-dispatchable-work; should_refill=true slots_free=5 dispatchable_disjoint=1 no_refill_reason=null）——有货可派却要结束本轮，调度层必须回派发（无合法退出路径）
wrote: false
```

**缺 `--in-flight`（无法直接量验证）⇒ fail-closed 拒绝**：

```
inner-wakeup-heartbeat: REFUSED — --in-flight 必填（结束心跳的直接量判据需要本会话在飞集合），不写入（reason=end-invariant-gate-requires-in-flight）
exit=1
(no .quay dir — nothing written)
```

**负控制（合法结束：满在飞无空槽）⇒ writer WRITES, exit=0**：

```
writer exit= 0
written dispatch-state: {"slots_free":0,"dd":6,"pool":6,"should_refill":false,"no_refill_reason":"no free slots (in-flight 5 + closed-but-live 0 >= cap 5)"}
```

**受影响测试文件全绿（零并发下定向跑）**：`inner-wakeup-heartbeat.test.mjs` 17/17、`inner-wakeup-heartbeat-check.test.mjs` 47/47、`semantic-observer-judge.test.mjs` 22/22；`tick-core-static-check` PASS；`red-on-omission-audit` band satisfied；precommit-guard verdict=allow（state=green, not-running）。

## Touches

- plugin/scripts/inner-wakeup-heartbeat.ts（写前直接量判结束不变式 + 拒绝路径）
- orchestration/fast-mode-tick-core.md（B3：心跳写失败不得睡，回派发）
- plugin/test/inner-wakeup-heartbeat.test.mjs（第 7 次同形回放拒绝用例）
- tasks/gap-ac53-end-invariant-gate.md（自身）
