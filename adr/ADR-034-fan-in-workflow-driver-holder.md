---
id: ADR-034
title: 锁的生命周期 = 工作的进程生命周期——fan-in workflow 锁收进 driver，释放只靠进程退出（废除分离 holder + 外部释放信号）
status: accepted
date: 2026-08-28
tags:
  - architecture
  - locking
  - fan-in
  - driver
  - predictability
---
## Decision（2026-08-28 人裁定 accepted）

**锁的生死必须与工作的进程生死重合。** 持锁的进程就是做工作的进程（或必然随它而死）；锁的释放只靠「持锁进程退出 → 内核自动关 fd」这一种机制，不设任何时间阈值，不依赖任何第三方外部信号。

1. **废除「分离 holder + 外部释放信号」**：不再用 `& disown` 的 bash 包装器持锁、靠「另一个进程删 flag」释放。这是「进程没死却指望它释放锁」的错误方向——让持锁进程活得过它的 caller。
2. **锁由受监督、可重启的 driver 进程持有**（或由必然随 driver 而死的直接子进程持有）：driver 死（任何原因，含 SIGKILL）→ 内核释放 flock → 重启后重评估。没有孤儿、没有残留锁、没有「卡死」这一态。
3. **锁路径不设任何时间阈值**（无 hold-max、无心跳 TTL、无 stale 偷锁）：内核的「fd 随进程退出关闭」是唯一且确定的机制。

## 背景（为什么是这个方向）

**实证 2026-08-28**：`gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in` 最后一次 fan-in 的 holder（pid 1446420）在 acquire 后、caller 于 ff 完成后删 flag 前被杀 → holder 孤儿化（PPID=1）+ 活着 → `while [ -e flag ]` 死循环 → workflow 锁持 23 分钟，阻塞所有后续 fan-in；靠人工删 flag 才释放。

**不可预期的两个来源**：
- ① holder 生命周期刻意与 caller 解耦（`& disown` → 孤儿化），「持锁者」与「做工作的进程」是两个生命；
- ② 释放依赖第三方外部信号（flag 文件删除）——第三方可以死、可以忘、可以被 SIGKILL。

**补丁方向被证伪**：dead-holder-only watchdog（gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in AC2）只释放死 holder——`kill -0` 是代理量（硬规则 4b），测「进程存在」不测「在推进」，活但停滞的 holder 永不释放。叠加 watchdog/hold-max/stale 都是为了补「分离 holder」架构的洞，方向错误。

## 被否的替代（2026-08-28 系统盘点 Linux + Node.js 后否决）

- **心跳/TTL/lease**（redlock 续租、proper-lockfile mtime-stale、systemd WatchdogSec）：重引入时间阈值——重蹈「1800s 切活 holder」（AC2 明确拒绝）与「stale 窗口误抢长 fan-in」两个相反方向的阈值问题；且仍是分离 holder 架构上的补丁。
- **fcntl lease（F_SETLEASE，lease-break-time=45s）**：唯一内核裁决的时间有界释放，但语义是文件访问冲突触发（非定时器）、每文件单租约、侵入性大。
- **PR_SET_PDEATHSIG**：只覆盖「父死」路径，不覆盖「父活但忘释放」；须去 disown + 额外 helper。
- **扩展 stale-holder-kill 偷已 acquire 的锁**：重引入时间启发；`kill -0` 仍是代理量。

**核心论据**：Linux/Node 都没有「活的停滞进程自动释放锁」的原语——flock/POSIX/OFD 锁全部随进程退出释放。所以正确方向不是给分离 holder 加恢复机制，而是让「持锁进程根本不会在 caller 死后继续活着」。

## 状态迁移

- 2026-08-28：accepted（人裁定：方向从「检测/恢复」改为「行为可预期」；发 outer 建任务落实）

## Consequences

- 锁的生死与工作的生死重合 → 行为可预期，无「卡死」态，无时间阈值整类（硬规则 4 推论二在锁路径自动满足）。
- 完成「不再 detach」架构收尾：suite 已是 driver 子进程（gap-fan-in-driver-mechanical-orchestration AC3，ppid→driver），锁 holder 是最后一个分离进程，收进 driver。
- 待落实（outer 建任务）：worker-driver.ts 改为自身持锁（或非分离直接子进程 + 死亡耦合）；删除 acquire/release 的 flag 协议与分离 holder；`fan-in-ff-merge.sh` 的 `--acquire-workflow-lock`/`--release-workflow-lock` 相应改造；单测负控制（driver 被杀 → 锁自动释放；排队者不被孤儿 holder 挡）。