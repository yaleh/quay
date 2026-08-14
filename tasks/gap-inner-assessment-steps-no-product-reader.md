---
id: gap-inner-assessment-steps-no-product-reader
title: inner 派发评估三步骤（slot-refill/ready-pool/heartbeat）无读产物判据——07:41 切驱动模式后该步未带过来，4.7h 无层处理（manager 12:2xZ 报）
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

**（inner 派发评估步骤无读产物判据——manager 2026-08-14 12:2xZ 报，第三版诊断，秒级证据）**。

**现象**（实测）：
```
主会话 tool_use（07:41Z 后）484+ 条，最大空档 23.5 分钟   ⇒ 唤醒没断
ScheduleWakeup 62 次，06:01 → 11:55                      ⇒ 一直在
Agent 派发 19 条，末次 11:24:39                          ⇒ 还在派
slot-refill        末次 09:39:12  ⇒ 停 2.7h
ready-pool-check   末次 08:08:35  ⇒ 停 4.2h
心跳写入            末次 07:41:43  ⇒ 停 4.7h
```

**根因（秒级）**：`ScheduleWakeup` 的 prompt 于 **07:41:46** 由具体文本切成哨兵 `<<autonomous-loop-dynamic>>`（此后全部 `noop:true`）；心跳文件停写于 **07:41:38** —— **相差 8 秒**。
**⇒ 换驱动模式时，写心跳/跑评估这一步没被带到新路径上。**（v1「唤醒链断」作废——唤醒 62 次从没断；v2「评估步骤莫名停了」不够准——它没被跳过，是不在新路径上。）

**这是 manager 的 C22 反面**：C22 管「投给两层⇒重复做」；**这次是「投给了一个明说不接的层，然后没有再投给能做的层」⇒ 零层在做 4.7h**（manager 自认：8 轮 tick-log 记「心跳 X 分钟未前移」从未升级，而它今天刚补的 A3 判据逐字写着「心跳陈旧⇒报并升级，⛔只记一笔」——补了判据继续只记一笔）。

**代价已实测**：08:56 起 `dispatch-record.jsonl` 每一条 reason 都是 outer/人口吻；11:0xZ `pool=5 · dispatchable_disjoint=5/5 · criterion_met=True · 在飞 1 · 空槽 4` 而无人派，直到 outer 手工补派 4 条。**subagent 预算已排除**（真实触顶=0）。**路由失败有真实代价的直接证据（manager 12:2xZ 补充）**：inner 确认诊断时逐字说「**之前两次只投给 outer 我完全没收到，这次直接到了**」——v1（唤醒链断）/v2（评估步骤停）两版诊断 inner 一条都没收到 ⇒ **跨层诊断若只投给不接的那层，等于没发生**。

**判据1**：给「本轮有没有跑评估步骤」一条**读产物**的判据——那三步**都有产物**（心跳 mtime / `slot-refill` 调用记录 / `ready-pool-check` 调用记录），**没有任何一层每轮读它**（= SPEC-tick-quality R6，inner 侧编号 I1）。实现面：某层每轮读这三个产物的新鲜度，陈旧即报「inner 派发评估未跑」。
**判据2（能取假·真样本不构造）**：**07:41–12:2x 这 4.7h 是现成缺席样本**——回放它，判据1 必须报红；当前任何一层读这三个产物（现在读的读数=陈旧）即为真样本。
**⚠️ 心跳写入只有一条路径、无条件过 AC53 END 闸（manager 12:4xZ C27 更正，核实现）**：
> **心跳只有一条写入路径，且无条件过 AC53 END 闸**（`inner-wakeup-heartbeat.ts` Usage 无 `--end` 开关，`:309` 写入在闸之后；「每次 reschedule 追加」与「END-of-tick 写入」是同一个动作的两个名字）。
> **⇒ 07:41–12:3x 的 0 行追加，由「在飞少算 ⇒ `slots_free` 虚高 ⇒ 闸误拒」完整解释**，不需要「追加路径没跑」这一支。
> **⊢ 判「评估是否恢复」仍用 `dispatch-record` 的自驱 reason（不受闸影响）；判「闸是否误拒」用 jsonl 行数 + 同刻三写法的 `in_flight_count` 一致性。**
**（演化记录：inner 先报「闸拒写」→ outer 转发 → manager 12:3xZ 先否决「闸拒」（误以为有两条路径）→ 12:4xZ C27 自我更正：只有一条路径、闸无条件，原「闸拒」解释成立——否决的【依据】错了，方向对了。教训：核任何「闸为什么拒」前先确认喂给它的量；本族有两个方向——把不同的当成同一个（前六次）/ 把同一个当成不同的（本次）。）**
**判据3 边界**：修法是**比对两条驱动路径的步骤集合**（具体 prompt 路径 vs 哨兵路径），不是查日志找漏跑（后者翻几百条找不到）。

**不覆盖**：不改唤醒机制（唤醒是好的）；不重建 inner 会话；不设心跳写入频率（那是 inner 侧机制）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 SPEC-tick-quality R6 + inner 心跳/slot-refill/ready-pool 三个产物的写点。
2. 判据1：读产物判据落地（哪层每轮读三产物新鲜度，陈旧即报）。
3. 判据2 能取假：07:41–12:2x 缺席样本回放红 + 当前读数=陈旧为真样本。
4. 判据3：比对两条驱动路径步骤集合（具体 prompt vs 哨兵）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：评估三步骤读产物判据落地（心跳/slot-refill/ready-pool 新鲜度，陈旧即报）。
- [x] AC2 判据2 能取假：07:41–12:2x 缺席样本回放红。
- [x] AC3 判据3：修法=比对两条驱动路径步骤集合，非查日志。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] inner 派发评估三步骤有读产物判据（心跳/slot-refill/ready-pool 陈旧即报，不静默）+ 07:41 缺席样本回放红 + 驱动路径步骤集合比对落地。

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（读产物判据落地：心跳 mtime + slot-refill 调用记录 + ready-pool 调用记录三者新鲜度，陈旧即报「inner 派发评估未跑」；与既有 A13 心跳检查同面）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（补测：07:41 缺席样本回放红 + 新鲜绿）
- tasks/gap-inner-assessment-steps-no-product-reader.md（自身）

## Test-Files

- plugin/test/inner-wakeup-heartbeat-check.test.mjs（新增 13 条 I1 测试：判据1 纯函数 + 07:41 回放红 + 新鲜绿 + 3b 无台账例 + 判别性新例）

## Evidence

**落地（实现面）**：`inner-wakeup-heartbeat-check.ts` 新增 I1 read-product criterion —— `judgeAssessmentSteps()` 读三个新鲜度信号（心跳 jsonl ts + `checker-cost.jsonl` 的 `ready-pool-check`/`slot-refill` 调用记录 `at`）；ready-pool/slot-refill 任一新度信号陈旧 ⇒ exit 1「inner 派发评估未跑」（`assessment-steps-stale` / `inner-assessment-steps-not-run`）。心跳信号照旧由既有「兜底心跳断」判据管（不双报）。无调用记录的步骤报 `not-recorded`（硬规则 3b：读不懂 ≠ 合格，独立取值，不假过不假红）。判据3（修法=比对两条驱动路径步骤集合）写入 checker 头注释。

**判据2 07:41 缺席样本回放红（AC2 测试，`makeRootWithAssessment`：heartbeat 4.7h / ready-pool 4.2h / slot-refill 2.7h 陈旧）**：
```
✔ I1 CLI --json — the 07:41 absence replay (all three stale) exits 1 with inner 派发评估未跑 (判据2)
  → verdict DEAD · status assessment-steps-stale · reason inner-assessment-steps-not-run
✔ I1 CLI — the 07:41 absence replay names 派发评估未跑 in human output
```

**判别性新例（旧心跳判据看不见：inner 醒着但评估停了）**：
```
✔ I1 CLI --json — heartbeat FRESH but ready-pool call record STALE exits 1 (the discriminating case the old checker missed)
  → heartbeat fresh · ready-pool stale(4.2h) ⇒ DEAD assessment-steps-stale
```

**新鲜绿 + 无台账 3b 例**：
```
✔ I1 CLI --json — fresh all three ... exits 0 (GREEN)
✔ I1 CLI --json — a fresh heartbeat with NO checker-cost ledger is GREEN with NOT-EVALUATED signals (3b)
```

**scoped 门**：`bash scripts/test.sh --for-task gap-inner-assessment-steps-no-product-reader --allow-thin` → `ℹ tests 72 / pass 72 / fail 0`，exit 0（含全部 13 条新 I1 测试 + 既有 59 条全绿）。

**ts-typecheck**：`fan-in-ts-typecheck-gate.ts` → `no new/moved .ts in the declared write surface — no typecheck gate needed` · ADMITTED (exit 0)。补跑 `npx tsc --noEmit` → 0 errors（修改的是既有 .ts，非新增）。

**真机读数（main checkout，2026-08-14 13:09Z）**：`--json` 输出 `assessmentSteps.status = assessment-steps-ok`（heartbeat fresh 1963s / readyPool fresh 120s / slotRefill not-recorded）；同次输出的 DEAD 来自既有 AC53 结束不变式（machine slot-refill 说 should_refill=true 有可派未派），与本次读产物判据无关。
