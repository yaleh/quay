---
id: gap-adr034-fan-in-lock-holder-supervised
title: ADR-034 落实——废除 & disown 分离 holder，锁改由受监督 driver 进程持有（活但停滞 holder 永不释放的根治）
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

落实 ADR-034（`adr/ADR-034-fan-in-workflow-driver-holder.md`，accepted，afba4ae23 已入 develop）。

**背景实证（2026-08-28）**：`gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in` 最后一次 fan-in 的 holder（`& disown` 分离 bash，pid 1446420）在 acquire 后、caller 于 ff 后删 flag 前被杀 → holder 孤儿化（PPID=1）且活着 → `while [ -e flag ]` 死循环 → fan-in workflow 锁持 23 分钟阻塞全仓 fan-in，人工删 flag 才释放。dead-holder-only watchdog（该任务 AC2 引入）只释放死 holder，`kill -0` 是代理量，**活但停滞的 holder 永不释放**。

**ADR-034 裁定方向**：不给分离 holder 加恢复机制（watchdog/lease/stale/heartbeat 均否决——重引入时间阈值），改为**让持锁进程根本不会在 caller 死后继续活着**——锁的生死 = 工作的进程生死。

## Plan

1. `worker-driver.ts` 改为自身持锁（受监督、可重启的常驻进程持有 flock fd），或由必然随 driver 而死的非分离直接子进程持有；driver 死（任何原因含 SIGKILL）→ 内核自动释放。
2. 废除 `& disown` 分离 holder + flag 文件释放协议（release 不再依赖第三方删 flag）。
3. `fan-in-ff-merge.sh` 的 `--acquire-workflow-lock`/`--release-workflow-lock` 相应改造。
4. 单测负控制：driver 被杀 → 锁自动释放；排队者不被孤儿 holder 挡；持锁不阻塞 driver 异步派发（SPEC-fan-in-driver-mechanical-orchestration「不 detach ≠ 同步阻塞」）。
5. AC 判据按 ADR-034：锁的生死 = 工作的进程生死；锁路径不设任何时间阈值（无 hold-max/TTL/stale）。

**与既有任务关系（处置裁量）**：
- `gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in`（done，AC2=dead-holder-only）——本 ADR 废除 dead-holder-only 方向，其 AC2 语义需 retreat 或 supersede 标注。
- `gap-fan-in-driver-mechanical-orchestration`（done，AC3=suite 是 driver 子进程）——「不再 detach」已走一半，锁 holder 是最后一个分离进程。
- `gap-mech-fan-in-acquire-lock-timeout-queue-semantics` 的 AC2（排队第 2+ 位成功 acquire）与本改动相关。

## Acceptance Criteria

- [ ] AC1（能取假，锁随进程死）：driver 被杀（含 SIGKILL）→ flock 自动释放（⛔ 孤儿 holder 仍持锁 ⇒ 假）。
- [ ] AC2（能取假，无分离 holder）：`& disown` + flag 文件释放协议已废除（⛔ grep 仍见 disown holder / flag 释放 ⇒ 假）。
- [ ] AC3（能取假，不阻塞派发）：持锁不阻塞 driver 异步派发（⛔ 同步阻塞 ⇒ 假）。
- [ ] AC4（能取假，无时间阈值）：锁路径无 hold-max/TTL/stale 阈值（⛔ 引入时间阈值 ⇒ 假）。
- [ ] AC5（能取假，重启不残留孤儿持锁）：driver 重启后，排队中的 fan-in ff 不被孤儿 holder 阻塞——模拟 acquire 后 driver 被杀/重启，重启后某任务仍能 acquire 同一锁并完成 ff；进程树无 PPID=1 的持锁 bash（⛔ 重启后孤儿 holder 仍持锁挡排队 ff ⇒ 假）。（补：第二次同形事件 09:00-09:32 孤儿 holder 持锁 52 分钟挡 6 个 ff——AC1 验「driver 死锁随释放」但 flock fd 在孤儿 holder 手里不在 driver，AC1 与本次缺陷正交；本 AC 验端到端重启不残留。）
- [ ] AC6（能取假，生产观测，待外部）：落地后真实生产 fan-in 全程无孤儿 holder——从本任务落地时刻起，worker-outcome 无「孤儿持锁」类失败、lock-events 无跨重启存活的 acquire（⛔ 用 fixture/注入数据满足 ⇒ 假；⛔ 计落地前历史 ⇒ 假）。（待外部：需真实多任务 fan-in 生产观测，非测试可造。）

## Definition of Done

锁由受监督进程持有、随进程生死自动释放；分离 holder + flag 协议废除；AC1-AC5 全勾（AC6 待外部生产观测）；孤儿 holder 死锁根除。

## Touches

- plugin/scripts/worker-driver.ts（自身持锁 flock fd / 非分离子进程；废除 disown）
- plugin/scripts/fan-in-ff-merge.sh（--acquire/--release-workflow-lock 改造，废除 flag 释放协议）
- plugin/test/worker-driver.test.mjs（driver 死 → 锁自动释放负控制）
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs（不 detach ≠ 同步阻塞）
- tasks/gap-adr034-fan-in-lock-holder-supervised.md（自身）
