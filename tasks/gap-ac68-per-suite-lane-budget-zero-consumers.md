---
id: gap-ac68-per-suite-lane-budget-zero-consumers
title: AC68 per_suite_lane_budget 有产出零消费者——讲好的 lane 安排根本没生效（AC66 病又一实例）
status: ready
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

> **止损（2026-08-14 04:1xZ 首判「不需要」→ 05:0xZ 重判「需要」——新读数推翻）**。**首判（04:1xZ）**：load1=6.69、cpu_some_avg10=0.71、两条 suite ⇒ 「过订阅真但无可测代价」。**重判（05:0xZ，一次新读数推翻）**：两条 suite（AC61/AC62 各一槽），各自 `node --test --test-concurrency=16` ⇒ `worktree_node_tests=32`、`budget_in_use=36 > total_budget=16`、`budget_available=0`、**闸门自己判 `=> WAIT: CPU 饥饿（some avg10 >= 60）` 并附实测「重型测试在此负载下会超时（48.8s vs 隔离 2.0s）」**。**⇒ 过订阅已在造成可测代价**，且很可能是 AC57/AC61 那些 load-sensitive 失败的直接成因（闸门自己都说「重型测试在此负载下会超时」，我们把这类超时记成了 flake）。**C21 教训（已补 AC72 + C21）**：**「止损：不需要」不是一次性结论，它绑在当时那组读数上；读数变了必须重判**——否则它会变成永久豁免。AC68 是第一个实例，间隔不到一小时。**止损动作=让 `test.sh` 读那个已经算对的 `per_suite_lane_budget=8`（本任务处置二选一的①），正是当下 WAIT 的直接解**——不碰 lane/槽/并发模型（人 04:4xZ 裁定仍有效）。

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

- [x] AC1 per_suite_lane_budget 有消费者（test.sh 读它并按槽数除）**或** 被删除（二选一，不留「正确但无人读」的数字）。
- [ ] AC2 过订阅容忍判据（人 2026-08-14 06:1xZ 逐字「容忍过订阅，直到 OOM 或直接导致 suite 失败」——**推翻原数值阈值**「worker ≤ nproc」）：过订阅本身不算失败，触发条件是 **① OOM 或 ② 直接导致 suite 失败**。**第一个待归因样本**：inner 06:04:40Z「AC67 cert 红=测试 suite 环境脆弱（11 次 spawn node --experimental-strip-types 在 16-lane 下部分返回空）」——判别 (a) 该轮 laneCount/concurrent slots 读数 (b) 同组测试独占重跑是否绿 (c) 失败形态是 spawn 返回空/JS error（资源）而非断言失败（逻辑）。**归因未完成前不勾。** **⚠️ 归因 owner=inner（manager 2026-08-14 06:1xZ 裁），排序先 (c) 再 (a) 最后 (b)**：(c) 读已有日志零成本几乎能定案、(b) 占槽+~390s 只在 (c)+(a) 不能定案时才做。**⚠️ 本次归因只能由 inner 单方给出、第三方无法复核**——AC72 判据2 缺口的第一次实证（第三方读不到 cert 证据：worktree 的 full-suite-state 是 fork 继承旧记录、cert 真结果只活在 inner 会话）。
- [x] AC3 防嵌套 spawn（17-19 procs/load 18.70 那个缺陷）不回退。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] per_suite_lane_budget 有消费者或删除 + 并发 worker 上限机械可查 + 防嵌套 spawn 不回退。

## Touches

- scripts/test.sh（default_concurrency_formula 读 per_suite_lane_budget——已选二选一①，除槽）
- plugin/scripts/resource-gate.sh（per_suite_lane_budget 输出/计算配合——注释标明消费者）
- plugin/test/resource-gate.test.mjs（AC68 checker + 负控制 fixture——并发 worker 计数）
- tasks/gap-ac68-per-suite-lane-budget-zero-consumers.md（自身）

## Evidence

**AC1（二选一①——test.sh 读 per_suite_lane_budget，除槽数）**：`scripts/test.sh` `default_concurrency_formula()` 现读 `RESOURCE_GATE_CONCURRENT_SUITES`（test seam）→ `QUAY_MAX_CONCURRENT_SUITES`（旋钮②，默认 2，与 `resource-gate.sh` 的 `CONCURRENT_SUITE_SLOTS` / `full-suite-runner.ts` 的 `concurrentSuiteSlots()`/`defaultLaneCount()` 同一单源）并除槽：`default = max(1, floor((total_budget − in_use) / AMPLIFICATION / S))`。`per_suite_lane_budget`（H÷S）从「只算只打印、零消费者」变为「test.sh 与 full-suite-runner 都读它」——记录上的 lane 安排与实际行为一致。`plugin/scripts/resource-gate.sh:457-466` 注释与打印行已标明消费者。

**AC2（能取假，负控制沿 AC49 判据1 D2——落地方产出）**：checker + 负控制 fixture 落在 `plugin/test/resource-gate.test.mjs` 新增两测：
```
AC1/AC68  derivedConcurrency(16,1.0,0,2)=8  ← 16 核 2 槽 → 每 suite 8（32/16 缺陷修复）
AC1/AC68  derivedConcurrency(4,1.0,0,2)=2 ; (8,1.0,0,2)=4 ; (1,1.0,0,2)=1(clamp)
AC1/AC68  derivedConcurrency(16,1.0,8,2)=4 ← 与 AC1 in_use 预算相减正交复合
AC2/AC68  two concurrent suites total = 2×8 = 16 ≤ nproc(16)  ← checker 断言 cap
AC2/AC68  负控制（去除数 slots=1 → 每 suite=16 → 合计 32 > 16 ⇒ RED）
AC2/AC68  4 核：2 slots → 2×2=4 = nproc（绿）；pre-fix → 2×4=8 > 4（红）
```
即「删掉除数 ⇒ 检查必红」——checker 非结构恒绿（硬规则 4）。

**AC3（防嵌套 spawn 不回退）**：`default_concurrency_formula` 保留 `in_use` 相减（AC1 cross-layer total budget）；`AC5b`（budget-aware：16 核 12 在飞 → 4；预算耗尽 clamp 1）与 `AC5`（exec 行 5 处 derived-default 拼写、无硬编码 8）测试全绿。`concurrency-literal-check` 扫描 7 hits / 0 violations（无新并发字面量违规）。

**AC4（既有测试 + scoped 门）**：`scripts/test.sh --for-task gap-ac68-per-suite-lane-budget-zero-consumers --allow-thin` 全绿——**44 tests / 44 pass / 0 fail / 0 cancelled**（resource-gate.test.mjs 44 测，含新增 2 测 AC68）；scoped static checks 全过（GATE_EXIT=0）。相关性测试 `select-tests-for-touches.test.mjs` + `runner-grouping-flags-only.test.mjs` + `dead-code-after-return-check.test.mjs` = 37/37 pass。ts-typecheck gate：Touches 无 new/moved `.ts`，ADMITTED（exit 0）。

**⚠️ AC2 判据被推翻重写（outer 2026-08-14 判定 + 人 06:1xZ 裁定）**：原判据「实际 worker ≤ nproc」是**数值阈值**，人 06:1xZ 明确不按它判（「容忍过订阅，直到 OOM 或直接导致 suite 失败」）——**不是「未验证」而是「判据本身不对」**。重写为归因判据（见 AC2）：过订阅不算失败、OOM 或直接导致 suite 失败才触发；inner 06:04:40Z 的 16-lane spawn 红是**第一个待归因样本**（判别 (a) laneCount/slots 读数 (b) 独占重跑 (c) 失败形态资源 vs 逻辑）。**AC1/AC3/AC4 已核实现落地（test.sh:782/800 除槽、in_use 相减保留、44/44 scoped），勾选。退回 ready：AC2 归因完成才可 done。**（原 06:0xZ「止损=现在验 AC2 趁空窗」已被 manager 撤销——要验的量已不是判据。）
