---
id: gap-execution-loop-p4-dispatch-productization
title: P4 残余②③——dispatch 侧产品化（ready-pool-check + slot-refill 单一真相源）
status: ready
labels:
  - gap
  - productization
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

从 `gap-execution-loop-productization-p2-p4`（拆条）拆出的 P4 残余②③：`ready-pool-check` 与 `slot-refill` 产品化，派发计算单一真相源。

## Plan

1. ready-pool-check 产品化（派发判定单点）。
2. slot-refill 产品化（派发推荐单点）。
3. 派发计算单一真相源（⛔ 多真相源）。

## Acceptance Criteria

- [x] AC1（能取假，dispatch 单一真相源）：ready-pool-check/slot-refill 产品化后派发计算单一真相源；（⛔ 多真相源 ⇒ 假）。

## Definition of Done

dispatch 侧产品化落地（ready-pool-check + slot-refill 单一真相源）；AC1 全勾；全量 suite 绿。

## Touches

- plugin/scripts/ready-pool-check.ts（产品化——CONCURRENCY_CAP_DEFAULT 派生自 dispatch 单一真相源）
- plugin/scripts/slot-refill.ts（产品化——FIXED_DISPATCH_CAP 派生自 dispatch 单一真相源）
- plugin/test/ready-pool-check.test.mjs（AC1 断言随默认 3→5 更新）
- plugin/scripts/red-on-omission-audit.ts（a6_fixed_cap.redReading 更新：旧「回退 =3 ⇒ floor=12 假读数」已消除）
- plugin/scripts/fast-mode-telemetry.ts（注释更正：SLOT_STATUS_CAP_DEFAULT 是独立 slot-status 量，非 dispatch cap）
- tasks/gap-execution-loop-p4-dispatch-productization.md（自身）

## Evidence（实现 2026-08-31）

**根因（多真相源，硬规则 4b/5b 同族）**：派发并发 cap 此前有三个字面量真相源——`FIXED_DISPATCH_CAP=5`（slot-refill）、
`CONCURRENCY_CAP_DEFAULT=3`（ready-pool-check，⇒ floor=12 是假读数 ≠ 真值 floor=20）、`DEFAULT_DRIVER_CAP=5`（driver-config）。
`driver-config.ts`（AC155）已把后一份立为唯一并发字面量真相源，且 `cap-from-gate.ts:106`（`FIXED_EFFECTIVE_CAP =
defaultDriverConfig().worker.cap`）/ `promotion-driver.ts:99`（`CAP_DEFAULT`）/ `worker-driver.ts:3039`（`driverCap(root,"worker")`）
都已迁过去——但 slot-refill 的 `FIXED_DISPATCH_CAP` 与 ready-pool-check 的 `CONCURRENCY_CAP_DEFAULT` 仍是平行字面量。
`red-on-omission-audit.ts` 的 `a6_fixed_cap.redReading` 早已点名该缺陷：不带 `--cap 5` ⇒ 回退 `CONCURRENCY_CAP_DEFAULT=3` ⇒
floor=12 假读数（≠ 真值 floor=20）。

**修复**：
- `ready-pool-check.ts`：`CONCURRENCY_CAP_DEFAULT = defaultDriverConfig().worker.cap`（3→5，floor 12→20，与 slot-refill 一致）；
  `POOL_FLOOR` 自动 5×4=20。
- `slot-refill.ts`：`FIXED_DISPATCH_CAP = defaultDriverConfig().worker.cap`（值不变 5，但不再是平行字面量）。
- 两文件均不再有并发数值字面量（`concurrency-literal-check --gate` 0 违规，`= 5`/`= 3` 两条「已声明例外」消失）。
- 同步更新：`red-on-omission-audit.ts` redReading、`fast-mode-telemetry.ts` 注释、`ready-pool-check.test.mjs` 断言（3→5）。

**验证**：
- `node --experimental-strip-types --test plugin/test/ready-pool-check.test.mjs` → 132 pass / 0 fail。
- `node --experimental-strip-types --test plugin/test/slot-refill.test.mjs` → 112 pass / 0 fail。
- `node --experimental-strip-types --test plugin/test/{driver-config,concurrency-literal-check,cap-from-gate-cli}.test.mjs` → 32 pass。
- `node --experimental-strip-types --test plugin/test/{inner-wakeup-heartbeat,inner-wakeup-heartbeat-check,pool-quality-judge}.test.mjs` → 135 pass。
- `node --experimental-strip-types --test plugin/test/red-on-omission-audit.test.mjs` → 18 pass。
- `node --experimental-strip-types --test plugin/test/fast-mode-telemetry.test.mjs` → 86 pass。
- `node --experimental-strip-types plugin/scripts/concurrency-literal-check.ts --gate` → PASS（0 违规）。

**取假对照（硬规则 4 推论四）**：改前 `ready-pool-check` 不带 `--cap` 输出 `floor=12`（假读数），改后输出 `floor=20`（真值）——
若单测仍断言 12 即红（已把断言 3→5/12→20 更新并复跑，132 全绿）。若任何一处仍写 `= 3`/`= 5` 平行字面量，
`concurrency-literal-check --gate` 会报「违规」——但派生形（`= defaultDriverConfig().worker.cap`）无字面量，不触发。

## Needs-Human

**执行 2026-08-31T12:41:27.119Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
