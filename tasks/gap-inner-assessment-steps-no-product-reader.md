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

**代价已实测**：08:56 起 `dispatch-record.jsonl` 每一条 reason 都是 outer/人口吻；11:0xZ `pool=5 · dispatchable_disjoint=5/5 · criterion_met=True · 在飞 1 · 空槽 4` 而无人派，直到 outer 手工补派 4 条。**subagent 预算已排除**（真实触顶=0）。

**判据1**：给「本轮有没有跑评估步骤」一条**读产物**的判据——那三步**都有产物**（心跳 mtime / `slot-refill` 调用记录 / `ready-pool-check` 调用记录），**没有任何一层每轮读它**（= SPEC-tick-quality R6，inner 侧编号 I1）。实现面：某层每轮读这三个产物的新鲜度，陈旧即报「inner 派发评估未跑」。
**判据2（能取假·真样本不构造）**：**07:41–12:2x 这 4.7h 是现成缺席样本**——回放它，判据1 必须报红；当前任何一层读这三个产物（现在读的读数=陈旧）即为真样本。
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

- [ ] AC1 判据1：评估三步骤读产物判据落地（心跳/slot-refill/ready-pool 新鲜度，陈旧即报）。
- [ ] AC2 判据2 能取假：07:41–12:2x 缺席样本回放红。
- [ ] AC3 判据3：修法=比对两条驱动路径步骤集合，非查日志。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] inner 派发评估三步骤有读产物判据（心跳/slot-refill/ready-pool 陈旧即报，不静默）+ 07:41 缺席样本回放红 + 驱动路径步骤集合比对落地。

## Touches

- plugin/scripts/（读产物判据落地——具体文件按实现面，如 inner-assessment-steps-check.ts 或并入既有心跳检查）
- plugin/test/（补测）
- tasks/gap-inner-assessment-steps-no-product-reader.md（自身）

## Evidence

（落地后回填）
