---
id: gap-session-liveness-bclass-move-to-serial
title: session-liveness B 类等待型测试从 lowconc 移到 serial——serial 相 ALONE 先跑，不被 main 饿死
status: todo
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

probe 饿死（`probe must be alive first` / SESSION-BACK 超时）的修法**不是改 waterline**，是**把 B 类等待型测试从 lowconc 移到 serial**（人 2026-09-02 裁定）。

**为什么**：水位设计正确——`serial` 相 **ALONE 先跑于 main 之前**（`scripts/test.sh:1093`「a `serial` group that runs BEFORE it, ALONE, at concurrency $SERIAL_CONCURRENCY」），`lowconc`/`main` 再并行、main 填剩余容量。B 类等待型测试（session-liveness 族，真实 tmux + claude-probe 探针，等待探针建立）**不该与 main 并行**——它们在 lowconc 相里被 main 的并发填核饿死（subagent 实测：probe 窗口 loadavg 21.78–26.4、cpu_stall 28–62%）。

**subagent 已证伪的**：不是 lowconc=8（已降 3）、不是 tmux server 爆炸、不是泄漏孤儿——是「B 类等待探针与 main 并行」被饿死。**正确修法 = 让 B 类等待测试在 serial 相 ALONE 跑**（与 main 隔离），水位设计不动。

## Plan

1. 把 session-liveness 族 B 类等待测试（`session-liveness-signals-{integration,thresholds,kinds,thresholds-observers}` / `session-liveness-{events,heartbeat}`）的 `@test-group lowconc` 改 `@test-group serial`。
2. 同族 B 类等待测试（`outer-session-check`「claude child must be alive」、`suite-driver` 时序）评估是否同移 serial。
3. 验证：饱和下这些测试的探针在 serial 相 ALONE 建立（不再被 main 饿死）；main 长尾不回退（serial 相先跑不改变 main 的 LPT 收益）。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：session-liveness 族 B 类等待测试 `@test-group` 为 serial（不再 lowconc）——grep 测试文件 `@test-group serial`；（⛔ 仍 lowconc ⇒ 假）。
- [ ] AC2（能取假，生产载体）：饱和下这些测试 probe 稳定建立（probe must be alive / SESSION-BACK 不再间歇超时），N 只计落地后饱和轮；（⛔ 仍间歇 probe 超时 ⇒ 假）。

## Definition of Done

session-liveness 族 B 类等待测试移到 serial 相；AC1/AC2 勾；饱和下 probe 稳定建立；main 长尾不回退；全量 suite 绿。

## Touches

- plugin/test/session-liveness-signals-integration.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-signals-thresholds.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-signals-kinds.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-signals-thresholds-observers.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-events.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-heartbeat.test.mjs（@test-group lowconc→serial）
- tasks/gap-session-liveness-bclass-move-to-serial.md（自身）
