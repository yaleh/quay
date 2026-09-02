---
id: gap-suite-waterline-main-overlap-starves-lowconc-probes
title: waterline 调度器 main 与 lowconc 并发占满核——B 类等待型探针在 lowconc 窗口被饿死（probe 饿死真根因）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

probe 饿死（`probe must be alive first` / SESSION-BACK 超时）的真根因**不是 lowconc 并发**，是 **waterline 调度器让 main 与 lowconc 并发占满核**（subagent 实测，suite-load-sampler 每 5s `loadavg/cpu_stall`）：

- 红轮 902/903/905 的 probe 窗口：loadavg **21.78–26.4**、cpu_stall **28–62%**（不是 end-of-run 的 `load` 快照，是 per-window 采样）。
- lowconc=3 确认 live（`__GROUP__ concurrency=3 files=29`），但 main 经 waterline `mainCapacity = 16 − active_serial(8) − active_lowconc(3) = 5` **起跑 5 文件**、随 low 组排空升到 16。521 文件 main 相 + 16 文件 serial 相在 lowconc probe 窗口保持 ~16 测试文件（×2-3 子进程放大）跑。

**三候选裁决（实测）**：
- (a) main-group waterline 占满核 → **支持**（load 22-26 / cpu_stall 37-62% 就在 probe 窗口，由 main(5→16)+serial(8) 重叠 lowconc(3) 造成；waterline 前的 PHASE_OVERLAP 顺序调度是 serial+lowconc(~11 文件) 先跑、main 后，waterline 回归去掉了这个隔离）。
- (b) tmux server 爆炸 → **证伪**（357 进程 vs `ulimit -u` 63673；`new-session` 断言 exit-0，server 创建成功，失败在检测不在创建）。
- (c) 泄漏 claude-probe 孤儿 → 存在非因果（7-12 个 `sleep 10000` ≈ 零 CPU）。

**次要机制（解释「轮换」失败）**：LPT 按历史时长排序——上轮快的文件本轮排晚、probe 落峰值窗口 → 失败 → 记慢 → 下轮排早 → 通过。这是 flaky-rotation 签名。

## Plan

1. 恢复 B 类等待探针的**相隔离**：main 不填满 `main − active_serial − active_lowconc`——当 lowconc 文件仍活跃时给 lowconc 留 reserve，或 gate main 直到 lowconc 排空（waterline 前的顺序调度语义）。
2. 验证：probe 窗口不再被 main 并发占满（suite-load-sampler 读数），session-liveness 族在饱和下稳定绿；main 长文件启动 offset 不回退（不重新引入 main 晚启动长尾）。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：lowconc 活跃时 main 不并发占满核——`mainCapacity` 含 lowconc reserve 或 main 被 gate 到 lowconc 排空（grep suite-scheduler 逻辑）；（⛔ 仍 `main − active_serial − active_lowconc` 无 reserve ⇒ 假）。
- [ ] AC2（能取假，生产载体）：饱和下 session-liveness 族 probe 稳定建立（probe must be alive / SESSION-BACK 不再间歇超时），N 只计落地后饱和轮；（⛔ 仍间歇 probe 超时 ⇒ 假）。

## Definition of Done

waterline 恢复 lowconc 相隔离（main 不并发占满核）；AC1/AC2 勾；饱和下 session-liveness 稳定绿；main 长尾不回退；全量 suite 绿。

## Touches

- plugin/scripts/suite-scheduler.ts（mainCapacity 加 lowconc reserve / gate main 至 lowconc 排空）
- plugin/test/suite-scheduler.test.mjs（相隔离断言）
- tasks/gap-suite-waterline-main-overlap-starves-lowconc-probes.md（自身）
