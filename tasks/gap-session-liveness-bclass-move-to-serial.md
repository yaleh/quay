---
id: gap-session-liveness-bclass-move-to-serial
title: session-liveness B 类 probe 测试从 lowconc 移到 serial——probe 在宿主推导 lowconc 下不稳
status: ready
labels:
  - gap
  - defect
parent: null
children:
  - gap-lowconc-concurrency-restore-host-derived
extra:
  schema: execution
---
**type:** execution

## Proposal

probe 饿死（`probe must be alive first` / SESSION-BACK 超时）的修法**不是改 waterline**，是**把 B 类等待型测试从 lowconc 移到 serial**（人 2026-09-02 裁定）。

**为什么**：probe（真实 tmux server + claude-probe 进程）在 lowconc 相不稳——lowconc 与 serial 都宿主推导（`serial_lowconc_host_default`），lowconc 下 probe 进程建立超时（`probe must be alive`）。B 类等待型测试（session-liveness 族，真实 tmux + claude-probe 探针，等待探针建立）移到 serial 相才稳（人 2026-09-02 逐字裁定「probe 在 lowconc 不稳，就把它改到 serial 相」）。

**已证伪的**：不是 lowconc 值（8→3 都不稳）、不是 tmux server 爆炸、不是泄漏孤儿、**也不是「serial 相 ALONE 先跑隔离 main」**（那是 QUAY_SUITE_SCHEDULER=0 legacy fallback 注释，非默认统一调度器；统一调度器下 serial∥lowconc∥main 并发）。**正确修法 = probe 移到 serial 相（宿主推导并发），水位设计不动**。

## Plan

1. 把 session-liveness 族 B 类等待测试（`session-liveness-signals-{integration,thresholds,kinds,thresholds-observers}` / `session-liveness-{events,heartbeat}`）的 `@test-group lowconc` 改 `@test-group serial`。
2. 同族 B 类等待测试（`outer-session-check`「claude child must be alive」、`suite-driver` 时序）评估是否同移 serial。
3. 验证：饱和下这些测试的探针在 serial 相稳定建立（不再 `probe must be alive` 超时）；main 长尾不回退。

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
