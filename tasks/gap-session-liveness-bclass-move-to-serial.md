---
id: gap-session-liveness-bclass-move-to-serial
title: session-liveness B 类 probe 测试从 lowconc 移到 serial——probe 在宿主推导 lowconc 下不稳
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

probe 饿死（`probe must be alive first` / SESSION-BACK 超时）的修法**不是改 waterline**，是**把 B 类等待型测试从 lowconc 移到 serial**（人 2026-09-02 裁定）。

**为什么**：probe（真实 tmux server + claude-probe 进程）在 lowconc 相不稳——lowconc 与 serial 都宿主推导（`serial_lowconc_host_default`），lowconc 下 probe 进程建立超时（`probe must be alive`）。B 类等待型测试（session-liveness 族，真实 tmux + claude-probe 探针，等待探针建立）移到 serial 相才稳（人 2026-09-02 逐字裁定「probe 在 lowconc 不稳，就把它改到 serial 相」）。

**已证伪的**：不是 lowconc 值（8→3 都不稳）、不是 tmux server 爆炸、不是泄漏孤儿、**也不是「serial 相 ALONE 先跑隔离 main」**（那是 QUAY_SUITE_SCHEDULER=0 legacy fallback 注释，非默认统一调度器；统一调度器下 serial∥lowconc∥main 并发）。**正确修法 = probe 移到 serial 相（宿主推导并发），水位设计不动**。

## Plan

1. 把 session-liveness 族 B 类等待测试（`session-liveness-signals-{integration,thresholds,kinds,thresholds-observers}` / `session-liveness-{events,heartbeat}`）的 `@test-group lowconc` 改 `@test-group serial`。
2. 同族 B 类等待测试（`outer-session-check`「claude child must be alive」、`suite-driver` 时序）评估是否同移 serial。
3. 验证：饱和下这些测试的探针在 serial 相稳定建立（不再 `probe must be alive` 超时）；main 长尾不回退。

## Acceptance Criteria

- [x] AC1（能取假，机制级）：session-liveness 族 B 类等待测试 `@test-group` 为 serial（不再 lowconc）——grep 测试文件 `@test-group serial`；（⛔ 仍 lowconc ⇒ 假）。
- [ ] AC2（能取假，生产载体）：饱和下这些测试 probe 稳定建立（probe must be alive / SESSION-BACK 不再间歇超时），N 只计落地后饱和轮；（⛔ 仍间歇 probe 超时 ⇒ 假）。（待外部）

## Definition of Done

session-liveness 族 B 类等待测试移到 serial 相；AC1/AC2 勾；饱和下 probe 稳定建立；main 长尾不回退；全量 suite 绿。**若移 serial 后 probe 仍不稳（AC2 仍红），下一步 = 修测试本身以提高可靠性（人 2026-09-02 裁定），不再改相/并发。**

## Touches

- plugin/test/session-liveness-signals-integration.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-signals-thresholds.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-signals-kinds.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-signals-thresholds-observers.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-events.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-heartbeat.test.mjs（@test-group lowconc→serial）
- docs/analysis/test-file-baseline.txt（test-file-snapshot 基线重生成，吸收 lowconc→serial 改标）
- tasks/gap-session-liveness-bclass-move-to-serial.md（自身）
- tasks/gap-lowconc-concurrency-restore-host-derived.md（解除 parent/child 链接：低conc 任务是后续依赖非分解，改 depends_on）

## Needs-Human

**执行 2026-09-02T17:50:59.097Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red
- run_id：wk-prod-1788285192
- session_id：f75ddb0f-a5d1-4c7d-81ca-45340087e1c9
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-session-liveness-bclass-move-to-serial~wk-prod-1788285192~1788370217251-d3856c.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-session-liveness-bclass-move-to-serial-wk-prod-1788285192.log
