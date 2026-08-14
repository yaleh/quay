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
**判据4（拒写必须留痕——manager 13:5xZ 报，比接线更值钱）**：心跳载体只记录【写成功的轮】，被拒的轮零痕迹（REFUSE 只走 `console.error` stderr，jsonl 无行）⇒ **「inner 没跑评估」(a) 与「inner 跑了但被闸拒写」(b) 在 jsonl 上完全同形**——这就是三轮三个结论（13:1xZ 判 a / 13:2xZ 判降级误拒 / 13:4xZ 才定位结构版）而载体读数一模一样的机制。**修法：闸 REFUSE 时写 `{written:false, refuse_reason:...}` 到同一载体（或旁路载体）。⊢ 负控制现成**：此刻就是 REFUSE 状态 ⇒ 修好后立刻出现一条 `written:false` 行；修之前该行数恒为 0。**与硬规则 3 同族**：「缺席被伪装成在场」的镜像——这里是「被拒」被伪装成「没跑」。
**判据5**：既有测试全绿 + `--for-task` scoped 门绿。

**⚠️ 观察面黑窗的误诊持续时长（outer 实测读数）**：`invariant-violated` 在我的 tick-log 出现 3 次（10:05Z / 12:4xZ / 13:3xZ）——但那是 A13 的 stdout/逐轮读数，**jsonl 上三轮给一模一样的「无新行」**（10:05Z 我还在报「评估步骤停」、13:4xZ 才定位「闸结构无出口」）。载体不区分「没跑」与「被拒」是误诊持续 3 小时的载体级原因。

**优先级**：**高于当前在飞其它项**——它挡的不是一个任务，是整个 inner 层观测面（心跳停 ⇒ A3/A13 全读不到真值，outer 和 manager 都在盲判）。**但不停在飞轮次**（它只影响「结束一轮时拒写」，不影响正在跑的实现）。

**⚠️ 等 I1 的到期条件（manager 13:5xZ ④——「无到期条件的等待」是硬规则 12 的镜像，凭空不设出口）**：本任务与 I1 同碰 `inner-wakeup-heartbeat-check.ts`（C17 ③ 同文件拒派），默认等 I1 落地。**但若 I1 在 3 个 tick 周期（60 分钟）内未落地**（红窗反复重跑等），**改为先派 AC53-gate、I1 让路**——AC53-gate 挡的是整层观测面，I1 挡的是一条任务。N=60min（本任务为观测面恢复关键，成本结构已知：黑窗每多 20 分钟就是一次 A13 盲判；I1 的红窗重跑通常单轮 <20 分钟）。

**不覆盖**：不改 AC53 闸的判定逻辑本身（闸对宽集诚实是正确行为）；不改生产侧 slot-refill（已落地）；不改 awaiting-retry 语义。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 runMachineSlotRefill（:323）+ 闸 AC2 端不变式（:191-211）+ slot-refill 的 running 参数支持（:468-475）。
2. 判据1：runMachineSlotRefill 加 running 参数，闸传真观测的在跑集。
3. 判据2 能取假：当前真样本（传真集放行/不传拒写）回放红。
4. 判据3：空集默认与测得为 0 区分（未提供≠真零）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：runMachineSlotRefill 接 running 集，闸用真观测在跑集算 should_refill/slots_free。
- [x] AC2 判据2 能取假：当前真样本（传真集放行/不传拒写）回放红。
- [x] AC3 判据3：空集默认≠测得 0（未提供 vs 真零可区分）。
- [x] AC4 判据4：闸 REFUSE 时写 `{written:false, refuse_reason}` 留痕——「被拒」不再伪装成「没跑」；⊢ 修后立刻出现 written:false 行、修前恒 0。
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] AC53 闸接 running 集（心跳不再被 awaiting-retry 占宽集永久拒写）+ 空集/真零可区分 + 拒写留痕（written:false 行）+ 能取假。

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（runMachineSlotRefill 加 running 参数 + 闸传真观测在跑集 + CLI `--running` + 判据3 空集/真零区分）
- plugin/scripts/inner-wakeup-heartbeat.ts（END 写入路径传 running 集 + REFUSE 写 REFUSAL_FILE 留痕）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（补 running 集测试 + 空集/真零区分 + CLI `--running`）
- plugin/test/inner-wakeup-heartbeat.test.mjs（补判据1 传真集放行 + 判据4 拒写留痕）
- tasks/gap-ac53-gate-not-wired-to-running-set.md（自身）

## Test-Files

- plugin/test/inner-wakeup-heartbeat-check.test.mjs（98 项中含 5 项新增：判据1/判据3/判据2/CLI --running）
- plugin/test/inner-wakeup-heartbeat.test.mjs（22 项中含 3 项新增：判据1 传真集放行 + 判据4 两条）

## Evidence

**Scoped gate（`bash scripts/test.sh --for-task gap-ac53-gate-not-wired-to-running-set --allow-thin`）**：exit 0，98/98 pass（checker 76 + writer 22）。静态检查 tier 全 PASS。

**ts-typecheck gate**：`fan-in-ts-typecheck-gate.ts` exit 0 ——「Touches 无新增 .ts，无需 typecheck」；本任务只改已有 .ts，无新 .ts 文件。

**判据1 + 判据3（同一 workspace，checker CLI，真实 slot-refill 输出）**：
```
--running 缺省：       slot_denominator_source=in-flight-fallback  running_subagent_count=0  runningIds=null        should_refill=true  slots_free=5  → invariant-violated
--running ''（真零）： slot_denominator_source=running-subagents    running_subagent_count=0  runningIds=[]          should_refill=true  slots_free=5  → invariant-violated
--running r-1..r-5：   slot_denominator_source=running-subagents    running_subagent_count=5  runningIds=['r-1',...] should_refill=false slots_free=0  → ALIVE
```
判据3：缺省（null/未设置）与 `''`（测得真零）经 `slot_denominator_source` + `runningIds` null/[] 可区分；判据2：同一 workspace + 同 cap，`--running` 传真集 ⇒ should_refill=false ⇒ 闸放行，不传 ⇒ should_refill=true ⇒ 闸拒写——两个相反结论（能取假）。

**判据4（writer 端，真实拒绝）**：构造 dispatchable 空 in-flight 结束心跳（不传 --running），writer 拒绝：
```
inner-wakeup-heartbeat: REFUSED — 结束不变式违例，不写入（reason=inner-round-ended-with-dispatchable-work; should_refill=true slots_free=3 dispatchable_disjoint=1 no_refill_reason=null）
```
拒绝后 side-carrier `inner-wakeup-heartbeat-refusals.jsonl` 出现 `{"written":false,"ts":...,"refuse_reason":"inner-round-ended-with-dispatchable-work","evidence":{...}}`；修前该文件不存在（恒 0 行）；心跳 jsonl 仍无写（拒写 ≠ 心跳）。同 workspace 传 `--running r-1,r-2,r-3`（填满 effective-cap 3）⇒ slots_free=0 ⇒ should_refill=false ⇒ 闸放行，心跳写入成功（`slots_free:0, should_refill:false, no_refill_reason:"no free slots (running subagents 3 >= cap 3)"`）。
