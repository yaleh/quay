---
id: gap-inner-heartbeat-writer-not-invoked
title: inner 心跳 writer 步骤没被调用——93 分钟 30+ 轮零调用，闸从未有机会拒/放（manager 14:1xZ 报，meta-cc 动作记录证实）
status: todo
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

**（inner 心跳 writer 未被调用——2026-08-14 14:1xZ manager 报 + outer meta-cc 动作记录证实；AC53-gate 已落地但心跳仍不长 = 根不是闸）**。

**实测（meta-cc 查 inner 会话 tool_use，contains=inner-wakeup-heartbeat，since 12:00Z，38 条全枚举）**：
```
真正【调用 writer】的 Bash（node … inner-wakeup-heartbeat.ts …）只有 4 次：
  12:25:43 · 12:26:05 · 12:26:54 · 12:30:39
12:30 之后 → 零次（后续命中全是 grep/stat/消息正文的字符串）
jsonl 末行 ts=1786711051 = 12:37:31Z（与最后一次真实调用差 ~7min）
```

**可证伪预测已兑现**：AC53-gate 落地（c2add65d 14:04Z）后心跳**仍然不长**（jsonl 仍 57，14:14Z 实测）⇒ **根不是「闸结构拒写」**（闸从未有机会拒/放，因为 writer 没被调）⇒ **根是「这一步没跑」**。

**与已落地任务的边界（防重复）**：
```
I1（读产物判据）       → 加【读】判据：心跳/ready-pool/slot-refill 新鲜度，陈旧即报   ← 已落地
AC53-gate（接 running） → 修【闸消费者】：闸传真观测在跑集 + 拒写留痕                 ← 已落地
本条（writer 未调）     → 修【写入步骤本身】：inner 的驱动路径要【调用】writer        ← 未落地
```
**三个都是「喂给闸的量」族，但本条是写入侧的根**——前两条修的是「判据/闸怎么读」，本条修的是「writer 本身有没有被调」。

**判据1**：inner 驱动路径（ScheduleWakeup 哨兵路径 / fast-mode tick）**恢复对 `inner-wakeup-heartbeat.ts` 的调用**——每轮 reschedule 追加心跳行（AC53 AC3：每次 reschedule append 一行）。
**判据2（能取假·真样本不构造）**：**12:30–14:1x 这段 93 分钟就是现成缺席样本**——回放它（30+ 轮无 writer 调用），判据1 必须红；修复后下一轮 reschedule 出现新行。
**判据3**：与 AC53-gate 的「闸不再误拒」价值判据对齐——**闸不再误拒的前提是 writer 被调**；若 writer 永不调，AC53-gate 的价值判据（心跳恢复增长）也永不满足 ⇒ 本条是 AC53-gate 价值判据的前置。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改闸逻辑（AC53-gate 已修）；不改 I1 读产物判据（已落地）；不新建第二个心跳载体（沿用 jsonl，拒写才写旁路 REFUSAL_FILE）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 inner 的 ScheduleWakeup 哨兵路径 / fast-mode tick 里心跳写入步骤（现在在哪、为什么没被调）。
2. 判据1：驱动路径恢复 writer 调用（每轮 reschedule append）。
3. 判据2 能取假：93 分钟缺席样本回放红 + 修复后新行。
4. 判据3：与 AC53-gate 价值判据对齐（writer 被调 = 闸价值判据前置）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：inner 驱动路径恢复 writer 调用（每轮 reschedule append 心跳行）。
- [ ] AC2 判据2 能取假：12:30–14:1x 缺席样本回放红；修复后新行。
- [ ] AC3 判据3：与 AC53-gate 价值判据对齐（writer 被调是闸价值判据前置）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] inner 心跳 writer 步骤恢复调用（每轮 reschedule append）+ 93 分钟缺席样本回放红 + 心跳恢复增长（AC53-gate 价值判据满足）。

## Touches

- plugin/loop/fast-mode-loop-tick.md（inner 驱动路径补心跳写入步骤——outer 侧 C17：loop 文档 outer 独占，但 inner 执行；写入步骤实现属 inner 侧）
- plugin/scripts/inner-wakeup-heartbeat.ts（若调用侧需要调整）
- tasks/gap-inner-heartbeat-writer-not-invoked.md（自身）

## Evidence

（落地后回填）
