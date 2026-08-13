---
id: gap-concurrency-literal-only-at-definition-points
title: 并发数值字面量只允许在唯一定义点（QUAY_MAX_TASK_SUBAGENTS /
  QUAY_MAX_CONCURRENT_SUITES），其余处出现即 fail——按位置判定 + 显式声明例外（禁悄悄写死，不禁有理由的默认）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**「读宿主不写字面量」原则每次都对、每次都被绕过，因为没有任何东西会报出来。** 此刻仓库同时存在：`DEFAULT_SERIAL_CONCURRENCY=6`（今天 1e7bfbe6 才修掉）、`cpuQuota:"400%"`（昨天才发现）、`CONCURRENCY_CAP_DEFAULT=3`（还在）。原则不变成检查，就永远靠意志（C17）。

**人 2026-08-13 目标形态**：人指定两个量，其它值全部计算出来——
```
读宿主（不配置）      H = os.availableParallelism()
人指定（唯一定义点）  QUAY_MAX_TASK_SUBAGENTS       （旋钮①，当前 5；现散在 ready-pool-check.ts:186 的 3 + 传参约定 --cap 5）
                     QUAY_MAX_CONCURRENT_SUITES   （旋钮②，当前 2；现【不存在】）
                     QUAY_MAX_OVERSUBSCRIPTION    （旋钮③，默认 1.0；超订系数）
派生（不配置）
  并发槽数/单飞锁槽数  = QUAY_MAX_CONCURRENT_SUITES
  每套件 lane 预算     = H ÷ QUAY_MAX_CONCURRENT_SUITES
  资源闸预算          = H，按每套件 H÷S 记账
  ready-pool/slot-refill cap = QUAY_MAX_TASK_SUBAGENTS
  pool floor           = cap × floorMult（已有，不动）
```
配置面 = 既有 `$QUAY_GLOBAL_DIR`（per-host，非 `.quay/config.yml`——那是 per-workspace provider map）。

**检查**：并发相关的数值字面量**只允许出现在那两个定义点**，其余处出现即失败。**必须按位置判定，不按关键词**（复用 drive-contract-check.ts / test-framework-policy-check.ts 已解决两次的手法）。

**必要例外条款（否则检查是错的）**：`CONCURRENCY_CAP_DEFAULT=3` 有正当理由（手动跑保守回退）。所以**不一刀切禁，而要求这类回退【显式声明】**（如标记注释 `/* concurrency-default-fallback: manual-run conservative */`），**未声明的字面量才算违规**——禁的是「悄悄写死」，不是「有理由的默认值」。这个区分是检查能不能活下来的关键：一刀切的检查会在第一个正当例外出现时被绕过或删掉。

## Plan

1. 新建检查器（如 `plugin/scripts/concurrency-literal-check.ts`，仿 instrument-failure-check 形态）：扫并发相关字面量（并发数/槽数/lane 数/CPU 配额），按位置判定是否落在定义点之外。
2. 例外声明：`CONCURRENCY_CAP_DEFAULT=3` 等处加显式标记注释；未声明字面量 = 违规。
3. 接进 `run_static_checks`（代码类检查器）。
4. 与 `gap-single-flight-lock-2-slot-concurrent-suites` 配合：该任务落地后，`QUAY_MAX_*`（含 QUAY_MAX_OVERSUBSCRIPTION）成为唯一定义点，本检查验证所有并发值从那里派生。

## AC

- [x] AC1: 并发字面量只允许在唯一定义点（QUAY_MAX_TASK_SUBAGENTS / QUAY_MAX_CONCURRENT_SUITES / QUAY_MAX_OVERSUBSCRIPTION），其余处出现即 fail（按位置，非关键词）
- [x] AC2: 显式声明的回退默认允许（如 CONCURRENCY_CAP_DEFAULT=3 + 标记注释）；未声明字面量 = 违规
- [x] AC3: 全仓并发代码在声明例外后通过（不误报正当默认）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 检查器对当前仓库扫描：命中的字面量逐一标注（定义点/已声明例外/违规）+ 0 违规（7 命中全为已声明例外，0 违规）
- [ ] 全量套件绿（scoped 门绿；全量套件由 outer fan-in 验证）

## Touches

- plugin/scripts/concurrency-literal-check.ts（新检查器）
- plugin/scripts/ready-pool-check.ts（CONCURRENCY_CAP_DEFAULT=3 加声明注释）
- plugin/scripts/cap-from-gate.ts（FIXED_EFFECTIVE_CAP=5 加声明注释）
- plugin/scripts/slot-refill.ts（FIXED_DISPATCH_CAP=5 / RED_BACKLOG_CAP_DEFAULT=2 加声明注释）
- plugin/scripts/fast-mode-telemetry.ts（SLOT_STATUS_CAP_DEFAULT=3 加声明注释）
- plugin/scripts/pool-quality-judge.ts（cap: 5 加声明注释）
- plugin/scripts/laydown-set-check.sh（--test-concurrency=1 加声明注释）
- scripts/test.sh（run_static_checks 接入）
- plugin/scripts/capability-catalog.sh（新检查器 AC1c QUESTION/MATCHING 等声明）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照重生成）
- plugin/test/concurrency-literal-check.test.mjs（新检查器测试）
- plugin/scripts/checker-mutation-cases/concurrency-literal-check.sh（新检查器 mutation case）
- tasks/gap-concurrency-literal-only-at-definition-points.md（自身）