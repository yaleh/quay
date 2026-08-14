---
id: gap-ac53-gate-not-wired-to-running-set
title: AC53 闸未接 running 集——双消费者拆分只落生产侧，闸读宽集使 awaiting-retry 永久占 dispatchable_disjoint ⇒ 心跳结构上无出口（manager 13:4xZ 报）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（AC53 闸消费者未接 running 集——in-flight-resolve 只落了生产侧；manager 2026-08-14 13:4xZ 报，outer 读实现确证）**。

**根因链（读实现 + 同刻双跑对照）**：
```
slot-refill.ts:471  自己写着：「backward compat for callers not yet passing --running」
inner-wakeup-heartbeat-check.ts:323  runMachineSlotRefill({ root, inFlightIds=[], cap })
                     ⇒ 没有 running 参数 ⇒ 正是那句注释说的「not yet passing --running」的调用者
闸 AC2 端不变式（:191-211）用 dispatchable_disjoint（宽集，含 awaiting-retry）
⇒ awaiting-retry 任务（test-isolation/workflows-dual-copy 等 ac63）占 dispatchable_disjoint
⇒ 闸判定「该派没派」⇒ 拒写心跳 ⇒ 心跳永久停（已 62+ 分钟）⇒ 结构上无出口
```

**同刻双跑（同一秒级窗口，manager 实跑）**：
```
                        裸跑      --running(空集)   inner 传真集
in_flight_count         4         4                 5
running_subagent_count  4         0                 3
slots_free              1         5                 2
should_refill           True      True              false   ← 结论相反
⇒ 闸四合取              True      True              (会放行)
```

**这是 SPEC-in-flight-semantics §4 建议 2 只落地了一半**：生产者能给两个数（`in_flight_count` 与 `running_subagent_count` 并存），**闸仍读旧的那个、且连传 flag 的入口都没有**（签名无该参数）。

**判据1**：`runMachineSlotRefill` 增加 running 集参数；闸把它**自己那一轮真实观测到的在跑 subagent 集**传下去——`should_refill/slots_free` 用 running 集算（Consumer B），`dispatchable_disjoint` 保持宽集（Consumer A）。
**判据2（能取假·真样本不构造）**：**此刻状态就是真样本**——传真集 ⇒ should_refill=false ⇒ 放行；不传 ⇒ True ⇒ 拒写。同一秒、同一台机器、两个相反结论，回放必须红（现状=拒写）。
**判据3（3b 形态，manager 顺带报）**：裸传 `--running`（不给 ids）得到 `running_subagent_count=0 ⇒ slots_free=5`——**「没提供集合」与「真的一个都没在跑」输出完全同形** ⇒ 修时**空集默认不得成 0**，须区分「未提供」（null/未设置）与「测得为 0」（真零）。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**优先级**：**高于当前在飞其它项**——它挡的不是一个任务，是整个 inner 层观测面（心跳停 ⇒ A3/A13 全读不到真值，outer 和 manager 都在盲判）。**但不停在飞轮次**（它只影响「结束一轮时拒写」，不影响正在跑的实现）。

**不覆盖**：不改 AC53 闸的判定逻辑本身（闸对宽集诚实是正确行为）；不改生产侧 slot-refill（已落地）；不改 awaiting-retry 语义。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 runMachineSlotRefill（:323）+ 闸 AC2 端不变式（:191-211）+ slot-refill 的 running 参数支持（:468-475）。
2. 判据1：runMachineSlotRefill 加 running 参数，闸传真观测的在跑集。
3. 判据2 能取假：当前真样本（传真集放行/不传拒写）回放红。
4. 判据3：空集默认与测得为 0 区分（未提供≠真零）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：runMachineSlotRefill 接 running 集，闸用真观测在跑集算 should_refill/slots_free。
- [ ] AC2 判据2 能取假：当前真样本（传真集放行/不传拒写）回放红。
- [ ] AC3 判据3：空集默认≠测得 0（未提供 vs 真零可区分）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] AC53 闸接 running 集（心跳不再被 awaiting-retry 占宽集永久拒写）+ 空集/真零可区分 + 能取假。

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（runMachineSlotRefill 加 running 参数 + 闸传真观测在跑集）
- plugin/scripts/inner-wakeup-heartbeat.ts（END 写入路径传 running 集）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（补 running 集测试 + 空集/真零区分）
- tasks/gap-ac53-gate-not-wired-to-running-set.md（自身）

## Evidence

（落地后回填）
