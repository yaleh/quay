---
id: gap-mech-fan-in-acquire-lock-timeout-queue-semantics
title: 机械 fan-in acquire-workflow-lock 步 120s 超时与锁排队语义矛盾——队列等待被误杀（unbounded
  正确性锁不该有短超时）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

机械 fan-in 第一步 `acquire-workflow-lock` 在 `worker-driver.ts:1640` 被 `mechSh(..., 120_000)` 套了 **120s kill 超时**，与锁的排队语义矛盾——`fan-in-ff-merge.sh:203-205` 自述 workflow 锁是「正确性锁、unbounded `flock -x`、绝不因排队等待过久而放行，watchdog 只兜死持有者、不是等待超时」。排队等待正是这把锁存在的意义，120s 恰在「等待」时触发。

**实测代价（首个机械 fan-in 生产任务就撞上，manager 读码+读载体核实）**：`gap-web-session-drops-queue-operation-records`（13:24 派发）worker 实现完（commit c3e668899），机械 fan-in step 1 红 → `worker-outcome.jsonl` 记 `mechanical_fan_in:{outcome:red,step:acquire-workflow-lock,reason:exit null}` → exited-not-landed。失败时它排队列第 2 位（前有 ff-ref-update 持锁 ~20.9min + longtail 排第 1），120s 连第一个持有者都等不过（~10 倍差）。`.quay/fan-in-workflow-lock-events.jsonl` 15 样本持有时长中位 **30.2min**（语义路径 1820–1845s = 1800s watchdog + 轮询）；SPEC §1.2 机械持有目标 ~10min。

**附带**：这是 `gap-fan-in-driver-mechanical-orchestration` AC1（锁时长塌缩到机械时长）的首个生产观测落点——机械路径首个任务 step 1 就死，机械持有时长至今零成功样本。修掉 120s 后 AC1/AC4/AC5 才可能有真读数。

## Plan

1. `worker-driver.ts:1640` acquire 步的 120_000 超时去掉，或换成「远超机械持有时长 × 队列深度」的值（unbounded 亦可——死持有者已由 1800s watchdog 兜底）。
2. ⛔ 其余 8 步超时（merge/anti-drift/typecheck 120s、scoped 600s、doc 300s）是有限时长步骤，正常，不动。
3. ⛔ 修法避开再设数值阈值（SPEC-fan-in-workflow-lock-and-S1 §6：成本未测量不设锁持有秒数阈值）。

## Acceptance Criteria

- [x] AC1（能取假，排队语义）：acquire-workflow-lock 步不再有 120s 短超时——排队等锁时不被 kill（unbounded 或远超机械持有时长×队列深度，死持有者由 1800s watchdog 兜）；（⛔ 仍 120s kill ⇒ 假）。
- [ ] AC2（能取假，生产能产）：一个排在队列第 2+ 位的机械 fan-in 任务成功 acquire（不 red at step 1、不 exit null）；（⛔ 仍 step 1 红 ⇒ 假）。（待外部）

## Definition of Done

acquire 步 120s 超时去掉/放宽；AC1-AC2 全勾；机械 fan-in 首个任务成功 acquire，产出 AC1（锁时长）首个成功样本。

## Touches

- plugin/scripts/worker-driver.ts（:1640 acquire 步超时去掉/放宽）
- plugin/scripts/driver-runtime.ts（runAsync 支持 Infinity = unbounded，⛔ setTimeout(…, Infinity) → 1ms footgun）
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs（acquire 排队语义测试 + 短超时负控制）
- tasks/gap-mech-fan-in-acquire-lock-timeout-queue-semantics.md（自身）
