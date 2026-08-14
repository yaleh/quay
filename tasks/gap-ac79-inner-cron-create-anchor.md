---
id: gap-ac79-inner-cron-create-anchor
title: inner 加 CronCreate 锚（AC79，人 14:2xZ 裁定三层统一应用 CronCreate）——ScheduleWakeup 无外部可核证据，07:41 切模式致自驱死 4.7h
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

**（inner 加 CronCreate 锚——人 2026-08-14 14:2xZ 逐字裁定「把三层统一应用 CronCreate 加入本阶段的目标和 AC」）**。

**三条实测（manager 14:2xZ 报，立 AC 依据非偏好）**：
```
① ScheduleWakeup 无外部可核证据，CronCreate 有（CronList + 注册表收据，manager 连续 17 轮）
   代价：07:41:46 inner 切驱动模式 ⇒ 链断 ⇒ 自驱死 4.7 小时，三层加人误诊整个上午
② ScheduleWakeup 事实上不是 inner 的驱动源：169 次调用 delaySeconds 全为 1500(25min)，
   而实际唤醒间隔 0.6–11 分钟 ⇒ 真驱动是 task-notification，它是从未真正触发的兜底
③ CronCreate 也不免费：CronList 文档写明 "in this session" ⇒ 会话作用域
   ⇒ 光换机制不补配套 = 把一个不可核的机制换成另一个
```

**判据1**：inner 加 CronCreate 锚——meta-cc 查 inner 的 CronCreate ≥1 条（当前真值 0 ⇒ 此刻为假，非恒真）。
**判据2**：ScheduleWakeup 降为间隙加速器（⛔ 不删——event-driven 段仍有价值）；CronCreate 成为主驱动锚。
**判据3**：inner 的 cron prompt ⛔ 不得要求「读上下文记忆」，须与 manager 锚同形——**只放指针**（指向执行核，1 跳）。
**判据4**：与 AC80（prompt 正本）/ AC81（注册表收据）配套——三层各有正本+检查器+收据（本任务只落 inner 的 CronCreate 锚本身）。

**不覆盖**：不删 ScheduleWakeup（保留 event-driven 价值）；不改唤醒间隔；不在窗口内改（人裁定窗口内不得改任何唤醒机制）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 inner 当前 ScheduleWakeup 用法 + manager 的 CronCreate 锚形态（manager-tick-prompt.txt + CronList）。
2. 判据1：inner 加 CronCreate 锚（prompt 只放指针）。
3. 判据2：ScheduleWakeup 降为间隙加速器。
4. 判据3：prompt 同 manager 锚（只放指针）。
5. 判据4：与 AC80/AC81 配套。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：inner CronCreate ≥1 条（meta-cc 可查）。
- [ ] AC2 判据2：ScheduleWakeup 降为间隙加速器（不删）。
- [ ] AC3 判据3：prompt 只放指针（同 manager 锚形）。
- [ ] AC4 判据4：与 AC80/AC81 配套。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] inner CronCreate 锚落地（meta-cc ≥1 条）+ ScheduleWakeup 降为加速器 + prompt 只放指针 + 与 AC80/81 配套。

## Touches

- plugin/loop/fast-mode-loop-tick.md（inner 驱动路径加 CronCreate 锚——outer 侧 C17：loop 文档 outer 独占但 inner 执行；落地实现归 inner）
- plugin/scripts/（inner 侧锚注册表/检查器，若配套）
- tasks/gap-ac79-inner-cron-create-anchor.md（自身）

## Evidence

（落地后回填）
