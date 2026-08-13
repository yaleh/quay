---
id: gap-inner-self-wake-sleep-empty-slots-not-dispatch
title: inner 满池自选长睡——空槽+池有货+不派的第三种成因（决策依据与结果分记录 / 有货可派不结束一轮）
status: ready
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
不是 subagent 预算触顶，也不是 inner 占回合做主线程编辑，而是 **inner 在满池状态下长睡**（
「自选」只是表象——根因见下，它只是在照文档执行）。

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

**根因更正（manager 2026-08-13，改写修法——旧结论「不是机制上限、是它自己选」错了一半）**：
one-per-wake 不是 inner 没填满/偷懒，inner 派 1 条是**严格遵守文档**。上限存在，只是不在 recommended 那处。
**同一份文档里两行互相矛盾 + 执行核转述模糊版 ⇒ 三处三种口径，谁执行谁自己挑一个**：

| 位置 | 文本 |
|---|---|
| `plugin/loop/fast-mode-loop-tick.md:321`（A12 执行文本） | 「should_refill=true 且 recommended 非空 ⇒ 立即按步骤 4 派发 **1-2 条**」 |
| `plugin/loop/fast-mode-loop-tick.md:340`（recommended 字段说明） | 「recommended = 建议立即派发的候选（**至多 slots_free 个**）」——**候选集怎么算**，不是派几个 |
| `plugin/loop/fast-mode-tick-core.md:45`（执行核 A12） | 「按步骤 4 逐候选检查后派发」——**模糊版，不写数量** |

`slot-refill.ts:34` 的 "up to slots_free" 同样只是候选集上限。**「外力推一次只填一个槽」不是 inner 偷懒，
是它照做**（照 :321 的 1-2 条字面量）。

**修法三件，缺一不可**：
1. **定死一个口径**：应是「派到 `should_refill` 变假或达 `slots_free`」（不变式驱动）——不是「1-2 条」
   这个凭空的字面量（**硬规则 4 推论二形状**：一个不依赖任何宿主/负载读数的写死数字）；
2. **`:321` / `:340` / 执行核 `:45` 三处同步**——改一处等于没改，下一个照文档办事的人会把它改回去；
3. 实现按①，并在**每次派发后重估**不变式（派一条 → 重跑 slot-refill → 仍 `should_refill ∧ 有槽` 则再派）。

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
- [ ] AC6: 派发口径三处同步定一——不变式驱动「派到 should_refill 变假或达 slots_free」，弃「1-2 条」字面量
      （`plugin/loop/fast-mode-loop-tick.md:321/:340` + 执行核 `fast-mode-tick-core.md` A12 三处一致）
- [ ] AC7: 每次派发后重估不变式（派一条 → 重跑 slot-refill → 仍 `should_refill ∧ 有槽` 则再派）

## Definition of Done

- [ ] AC1–AC7 全部勾上
- [ ] 负控制样例贴出（04:02:52Z + 04:22Z 两样本回放报红）
- [ ] 全量套件绿

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（或 inner 心跳写入方——五键落盘 + 追加式 jsonl）
- plugin/scripts/slot-refill.ts（如需）
- plugin/loop/fast-mode-loop-tick.md（:321「1-2 条」→ 不变式驱动 + :340 说明同步）
- plugin/loop/fast-mode-tick-core.md + orchestration/fast-mode-tick-core.md（执行核 A12 口径同步）
- tasks/gap-inner-self-wake-sleep-empty-slots-not-dispatch.md（自身）
