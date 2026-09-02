---
id: gap-lowconc-concurrency-8-starves-bclass-waiting
title: lowconc 并发从人裁定 3 被 AC74 宿主推导改成 8——B 类等待型测试 CPU 饥饿（session-liveness 真失败根因）
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

`session-liveness-signals-*` 系列（`@test-group lowconc`，B 类等待型，真实 tmux + claude-probe 探针）在 fan-in suite 里轮流失败，6 次失败全同形：探针进程 ~1-2s 内建立不起来/消失 → SESSION-GONE / probe must be alive。**真根因是 AC74 回归**（subagent 实锤，证据链完整）：

- **之前** `scripts/test.sh`: `LOWCONC_CONCURRENCY="${QUAY_LOWCONC_CONCURRENCY:-3}"`（硬编码 3，人裁定）。
- **之后**（commit `dead23ce56`，AC74，2026-08-14）`scripts/test.sh:498`: `LOWCONC_CONCURRENCY="${QUAY_LOWCONC_CONCURRENCY:-$(serial_lowconc_host_default)}"` → 本机 16 核算出 **8**。
- `scripts/test.sh:1241` 注释仍写「default 3」，没随 AC74 更新（漂移点）。

**人裁定原文**（`gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive.md`）：「并发取 3 不取 8：B 类是等待型需要被及时调度，并发太高会让它们又开始饿——那正是它们当初被踢出主体的原因。」

**机制**：16 核被吃满（waterline 让 main 占满剩余核），B 类等待型测试的探针进程被饿死/不可调度——正是人裁定预言的「又饿」。失败文件每轮轮换（integration/thresholds → kinds/heartbeat）证明是负载诱发 flaky 非单一断言 bug；同一套测试在绿 suite 全绿证明断言与被测代码正确。**这也解释了 flaky 集群第 3 组（outer-session-check「claude child must be alive」同 tmux+claude-probe 探针）与第 2 组（suite-driver 时序）**——都是 B 类等待型被 lowconc=8 饿死。

## Plan

1. `scripts/test.sh:498` lowconc 改回固定 **3**（人裁定语义值，非机器规格字面量——AC74「读宿主」重构误伤了它）。
2. 同步 `:1241` 陈旧注释（default 3 → 实际值）。
3. **根因是 serial 与 lowconc 共用一个宿主推导默认**（`serial_lowconc_host_default`），把两个语义不同的并发值绑在一起——若保留 env 覆盖，给 lowconc 一个**独立于 serial** 的默认值函数，不再共用。serial 组是否回退 8 另议（有 `gap-suite-concurrency-8-green-serial-group` 背书）。

## Acceptance Criteria

- [x] AC1（能取假）：lowconc 并发默认 = 3（非宿主推导 8）——`scripts/test.sh` grep lowconc 默认值回 3，或独立默认函数返回 3；（⛔ 仍宿主推导 8 ⇒ 假）。
- [ ] AC2（能取假，生产载体）：落地后 session-liveness-signals 系列在并发 suite 下稳定绿（探针进程建立/存活，不再 SESSION-GONE），N 只计落地后轮；（⛔ 仍饥饿失败 ⇒ 假）。（待外部）

**落地后归因（2026-09-02，fan-in suite 红）**：AC1 落地正确（`--lowconc-concurrency` 回 3）。落地轮 suite 仍红——`session-liveness-signals-kinds.test.mjs:139` "probe must be alive"（探针建立超时 ≈192s=HANG_GUARD_MS，非 marker-stale 断言）。**lowconc=8 假说被证伪**：该失败在 lowconc≤8 下亦现（gap-scoped-gate-lpt-order、gap-test-file-snapshot-worktree-drops-realinstall ×2 等，47 轮约 3 次），lowconc≤3 下 1/2 轮——非 lowconc 值决定。develop 已立案 `gap-session-liveness-marker-stale-fires-on-tick-log`（「lowconc=8 假说证伪」，并指出 6 次历史失败类型多样 probe/SESSION-GONE/CANT-SEND/marker-stale，非单一饿死）。本任务 lowconc 回 3（AC1）正确且必要，但 AC2「稳定绿」的真根因在 session-liveness 家族自身的多样成因（probe 建立 / marker-stale gating 等）、非并发值——留（待外部），由后续根因任务收敛。

## Definition of Done

lowconc 并发回人裁定 3（或独立默认函数）；:1241 注释同步；AC1/AC2 勾；session-liveness 并发下稳定绿；serial 组是否回退有明确结论；全量 suite 绿。

## Touches

- scripts/test.sh（lowconc 默认 8→3 独立默认函数 + :1241 注释同步）
- plugin/scripts/runner-concurrency.ts（LOWCONC_CONCURRENCY_DEFAULT=3 + defaultLowconcConcurrency + --lowconc-concurrency）
- plugin/scripts/full-suite-runner.ts（lowconc 默认回 3 + 注释同步）
- plugin/scripts/suite-params.ts（注释同步）
- plugin/test/resource-gate.test.mjs（判据2/判据4 lowconc 断言更新）
- plugin/test/runner-concurrency.test.mjs（defaultLowconcConcurrency 测试）
- plugin/test/full-suite-runner-cgroup.test.mjs（默认 lowconc=3 表更新）
- tasks/gap-lowconc-concurrency-8-starves-bclass-waiting.md（自身）
