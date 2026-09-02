---
id: gap-lowconc-concurrency-restore-host-derived
title: lowconc 并发回退宿主推导——用户 2026-09-02 反转 lowconc=3 硬编码裁定
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-session-liveness-bclass-move-to-serial
---
**type:** execution

## Proposal

用户 2026-09-02 逐字裁定反转先前「lowconc=3 语义值」判断：「lowconc 从 8 降回 3 是错的」「lowconc 和 serial lane 数现在都是计算出来的吧？应当持这一根据当前系统环境计算的机制」。

`gap-lowconc-concurrency-8-starves-bclass-waiting`（done）的 AC1 把 lowconc 从宿主推导 8 硬编码回 3——该回退是错的（lowconc=8 假说已被其自身「落地后归因」证伪：probe 饿死真根因在 session-liveness 家族自身多样成因，非并发值）。现按用户裁定把 lowconc 回退宿主推导，与 serial 一致。

## Plan

1. `plugin/scripts/runner-concurrency.ts` `defaultLowconcConcurrency()` 从固定 3 改回宿主推导（复用 `serial_lowconc_host_default` = `max(1, floor(nproc/(S×P)))`）。
2. `scripts/test.sh` lowconc 默认值从 `${QUAY_LOWCONC_CONCURRENCY:-3}` 改回 `${QUAY_LOWCONC_CONCURRENCY:-$(serial_lowconc_host_default)}`，同步陈旧注释。
3. `plugin/scripts/full-suite-runner.ts` / `suite-params.ts` 注释与默认值同步。
4. 相关测试断言更新（resource-gate / runner-concurrency / full-suite-runner-cgroup 的 lowconc 默认值表）。

## Acceptance Criteria

- [x] AC1（能取假）：lowconc 并发默认 = 宿主推导（`serial_lowconc_host_default`），非硬编码 3——grep `defaultLowconcConcurrency` 与 `scripts/test.sh` lowconc 默认行，均宿主推导；（⛔ 仍硬编码 3 ⇒ 假）。
- [x] AC2（能取假，无回归）：lowconc 与 serial 默认值一致（都 `max(1, floor(nproc/(S×P)))`），本机 16 核 = 8；（⛔ lowconc≠serial 默认 ⇒ 假）。

## Definition of Done

lowconc 回退宿主推导、与 serial 一致；AC1/AC2 勾；相关测试断言更新；全量 suite 绿（probe 饿死由 parent 任务 serial 迁移收敛，本任务须在 parent done 后落地）。

## Touches

- plugin/scripts/runner-concurrency.ts（defaultLowconcConcurrency 回宿主推导）
- scripts/test.sh（lowconc 默认回 serial_lowconc_host_default + 注释同步）
- plugin/scripts/full-suite-runner.ts（注释同步）
- plugin/scripts/suite-params.ts（注释同步）
- plugin/test/runner-concurrency.test.mjs（defaultLowconcConcurrency 测试更新）
- plugin/test/full-suite-runner-cgroup.test.mjs（lowconc 默认值表更新）
- plugin/test/resource-gate.test.mjs（lowconc 断言更新）
- tasks/gap-lowconc-concurrency-restore-host-derived.md（自身）
