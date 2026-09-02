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

- [ ] AC1（能取假）：lowconc 并发默认 = 3（非宿主推导 8）——`scripts/test.sh` grep lowconc 默认值回 3，或独立默认函数返回 3；（⛔ 仍宿主推导 8 ⇒ 假）。
- [ ] AC2（能取假，生产载体）：落地后 session-liveness-signals 系列在并发 suite 下稳定绿（探针进程建立/存活，不再 SESSION-GONE），N 只计落地后轮；（⛔ 仍饥饿失败 ⇒ 假）。

## Definition of Done

lowconc 并发回人裁定 3（或独立默认函数）；:1241 注释同步；AC1/AC2 勾；session-liveness 并发下稳定绿；serial 组是否回退有明确结论；全量 suite 绿。

## Touches

- scripts/test.sh（lowconc 默认 8→3 + :1241 注释同步 + 独立默认函数）
- tasks/gap-lowconc-concurrency-8-starves-bclass-waiting.md（自身）
