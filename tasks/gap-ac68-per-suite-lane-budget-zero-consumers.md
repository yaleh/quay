---
id: gap-ac68-per-suite-lane-budget-zero-consumers
title: AC68 per_suite_lane_budget 有产出零消费者——讲好的 lane 安排根本没生效（AC66 病又一实例）
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

> **止损（2026-08-14 04:1xZ，人 提「活行为缺陷有两项义务：修机制+止损」）：不需要。** 现读负载读数：node --test 7 进程（serial/lowconc 两相，concurrency 2/2/2/3/3/3/3）、load1=6.69（nproc 16）、cpu_some_avg10=0.71、今日峰值 load1=13.29（闸门上限 nproc×2≈32）、两槽 HELD、在飞 3 条 ⇒ **AC68 过订阅是真的但此刻不造成可测代价**——按硬规则 12/4 此时要求立即缓解就是"凭空设前置"。改法（二选一）随任务落地，落地即止损。

**缺陷①（manager 2026-08-14 报，位置已核）**：`per_suite_lane_budget`（H÷S）**有产出、零消费者**——讲好的 lane 安排根本没生效。

**闸门现读（两条 suite 在飞时）**：
```
total_budget=16  budget_in_use=2  budget_available=14
concurrent_suite_slots=2  per_suite_lane_budget=8    ← H÷S，算对了
worktree_node_tests=2  => GO
```
**但 `per_suite_lane_budget` 全仓四处命中，全在 `resource-gate.sh` 自己**（`:461` 算、`:462` 夹下限、`:463/:464` 打印）——`plugin/scripts/`、`scripts/`、`packages/` 无任何读它的代码。

**真正传给 `node --test` 的是 `test.sh:712-743` 的另一套推导**：`max(1, floor((total_budget − in_use) / AMPLIFICATION))`（`default_concurrency_formula`），**不除槽数**（AMPLIFICATION 已降到 1.0）。
```
实测佐证 node --test --test-concurrency=16（16 核，2 条 suite 在飞）
        pilot-measure-a/b 相隔 14ms 起跑，各自记 lanes=16 ⇒ 合计 32 workers / 16 核
```
根因是 **`in_use` 是拿锁后的一次快照**（`full_suite_lock_acquire` :1223 → `default_test_concurrency()` :1259）：**两条同时起跑时都读到 in_use≈0，各拿满预算。** `test.sh:715-721` 的头注释写明这套设计要防的正是「each worker deriving its own cap and multiplying beyond it（the 17-19 procs / load 18.70 defect）」——**它防住了嵌套 spawn，没防住并发 suite。**

**⇒ 一般形态，直接落在 AC66 上**：**一个量被正确算出、正确打印，而判据从不读它 ⇒ 记录上看它「在」，行为上它不在。** 一个没人读的正确数字比没有更糟——它让记录看起来像已经生效。

**处置二选一（manager 给）**：要么让 `test.sh` 读它（并发 suite 各自按 per_suite_lane_budget 除槽数），要么删掉它（避免「正确但无人读」的数字让记录假装生效）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

**⚠️ 明确不覆盖（人 2026-08-14 04:4xZ 裁定终止）**：本任务**不改并发模型本身**（不降 1-slot、不做 serial 族跨 suite 串行、不调整 lane 设置）——处置范围只含 `per_suite_lane_budget` 二选一（让 `test.sh` 读它或删掉它）；并发模型改动不在其中、不在 AC69（AC69 是「槽满排队而非 WAIT」，不动模型），AC70 已标人裁定终止。理由：两条止损均已判「不需要」，无新读数支撑更大改动（硬规则 4 推论）。

## Plan

1. 读 resource-gate.sh:461-464（per_suite_lane_budget 计算）+ test.sh:712-743（default_concurrency_formula）+ :1223/:1259（in_use 快照时序）。
2. **二选一**：① 让 test.sh 读 per_suite_lane_budget（并发 suite 各按其除槽）——修根；② 删掉它（防记录假装生效）。
3. 能取假：两条并发 suite 的 node --test 实际 worker 数 ≤ per_suite_lane_budget（当前 16/16=32 > 8 即红）。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 per_suite_lane_budget 有消费者（test.sh 读它并按槽数除）**或** 被删除（二选一，不留「正确但无人读」的数字）。
- [ ] AC2 能取假：两条并发 suite 的 node --test 实际 worker 合计 ≤ nproc（当前 32/16 超即红）。
- [ ] AC3 防嵌套 spawn（17-19 procs/load 18.70 那个缺陷）不回退。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] per_suite_lane_budget 有消费者或删除 + 并发 worker 上限机械可查 + 防嵌套 spawn 不回退。

## Touches

- scripts/test.sh（default_concurrency_formula 读 per_suite_lane_budget 或删其推导）
- plugin/scripts/resource-gate.sh（per_suite_lane_budget 输出/计算配合）
- （检查器/负控制 fixture——并发 worker 计数）
- tasks/gap-ac68-per-suite-lane-budget-zero-consumers.md（自身）

## Evidence

（落地后回填）
