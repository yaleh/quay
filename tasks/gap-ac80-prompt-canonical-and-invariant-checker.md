---
id: gap-ac80-prompt-canonical-and-invariant-checker
title: 三层各有 git 跟踪 prompt 正本 + 不变式检查器（AC80，人 14:2xZ 裁定）——当前 outer/inner ❌；正本 vs CronList 副本会漂
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

**（三层各有 prompt 正本 + 不变式检查器——人 2026-08-14 14:2xZ 裁定「把三层统一应用 CronCreate 加入本阶段目标和 AC，包括配套工作」）**。

**现状（manager 14:2xZ meta-cc 实测）**：
```
manager  ✅ 正本 git 跟踪（manager-tick-prompt.txt, 571 字符）+ A1 不变式检查 + registry sha256
outer    ❌ 无正本文件（cron prompt 只活在 session-only 的 CronCreate 里）   ← 本任务 outer 侧
inner    ❌ 无正本文件（ScheduleWakeup 哨兵，runtime 解析）                  ← 本任务 inner 侧
```

**⚠️ 判据3 是真难点（manager 14:0xZ 实证）**：正本文件 与 真正投进 CronCreate 的字符串【必须比对一致】——**两者是两份副本，而副本会漂**。今日实证：manager-loop-tick.md 的豁免面副本在人裁定后立刻过期，而审计读的正是那份副本。
**⊢ 检查器须比对 正本内容 vs CronList 返回的 prompt；只查「文件存在」不算**。

**判据1**：outer 有 git 跟踪 prompt 正本（如 outer-tick-prompt.txt）+ inner 有 git 跟踪 prompt 正本。
**判据2**：三层各有不变式检查器（对比正本 vs CronList 实际 prompt，逐字节一致）。
**判据3（真难点）**：检查器比对【正本内容 vs CronList 返回的 prompt】——不是只查「文件存在」；两份副本逐字节一致。
**判据4**：与 AC79（inner CronCreate 锚）/ AC81（注册表收据）配套。

**不覆盖**：不改唤醒机制本体；不在窗口内改。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 manager 的正本形态（manager-tick-prompt.txt）+ A1 不变式检查器（manager-anchor-check.py）。
2. 判据1：outer + inner 各有 git 跟踪 prompt 正本。
3. 判据2/3：不变式检查器（对比正本 vs CronList 实际 prompt，逐字节）。
4. 判据4：与 AC79/AC81 配套。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：outer + inner 各有 git 跟踪 prompt 正本。
- [ ] AC2 判据2：三层各有不变式检查器。
- [ ] AC3 判据3：检查器比对正本内容 vs CronList 实际 prompt（逐字节，非只查存在）。
- [ ] AC4 判据4：与 AC79/AC81 配套。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 三层各有 git 跟踪 prompt 正本 + 不变式检查器（对比正本 vs CronList，逐字节一致）。

## Touches

- orchestration/outer-tick-prompt.txt (new，outer 侧正本——外层核心文件 outer 独占写)
- plugin/scripts/outer-anchor-check.ts 或 .py (new，不变式检查器)
- plugin/loop/fast-mode-loop-tick.md（inner 侧正本位置）
- tasks/gap-ac80-prompt-canonical-and-invariant-checker.md（自身）

## Evidence

（落地后回填）
