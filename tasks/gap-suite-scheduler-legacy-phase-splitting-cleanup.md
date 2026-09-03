---
id: gap-suite-scheduler-legacy-phase-splitting-cleanup
title: 统一清理测试调度 legacy 分相——PHASE_OVERLAP + A watcher + run_selected fallback +
  「serial ALONE」误导注释
status: done
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

统一调度器（`gap-suite-dynamic-waterline-scheduler`，`QUAY_SUITE_SCHEDULER=1` 默认）已取代静态分相，但 legacy 分相的代码/注释仍散布多处，且**误导性**——`scripts/test.sh:1093`「serial runs BEFORE it, ALONE」注释描述的是 **legacy fallback（QUAY_SUITE_SCHEDULER=0）** 的行为，不标明「这是 legacy fallback、非默认统一调度器」，导致误读（实证：按它判「serial 相隔离」去修 probe 饿死，方向错）。

**legacy 面清单（实测 grep）**：
1. **scripts/test.sh** `run_selected`（`:1000` 起）+ `PHASE_OVERLAP`（`:511-522`/`:1176-1181`）+ `MAIN_TAIL_OVERLAP`（`:524-543`/`:1197-1213`/`:1279` + bucket 路径 `:1717-1739`）+ 「serial ALONE」注释（`:1093` + bucket 路径「serial runs sequentially BEFORE lowconc」`:1717` + scoped `--group lowconc`「ALONE at its own concurrency」`:1387`）+ `QUAY_SUITE_SCHEDULER=0` fallback（`:1139-1140`）——整套 legacy 分相路径（RETIRED，仅作 fallback 保留）。
2. **suite-params.ts**（`:48` 自认「only take effect on the QUAY_SUITE_SCHEDULER=0 legacy fallback path」`phase_overlap`/`main_tail_overlap_lanes`）。
3. **runner-concurrency.ts**（`:105-116` `QUAY_PHASE_OVERLAP` → P=2/1）。
4. **full-suite-runner.ts**（`:1234-1243`/`:2535-2544`/`:2622` PHASE_OVERLAP + `:2554` A watcher）。
5. **12 个测试文件** pin 旧行为：full-suite-runner-cgroup / fan-in-execute-paths / full-suite-runner-phases / runner-concurrency / select-tests-for-touches / runner-grouping-flags-only / suite-params / resource-gate / suite-speed-nested-skip / test-phases-order / runner-grouping-serial-anti-stomp / suite-bucket-load-sensitive-isolation（后 3 个为 2026-09-02 复查补漏）。

## Plan

二选一（或组合，worker 定）：
1. **全量退役**：删 legacy fallback（run_selected + PHASE_OVERLAP + MAIN_TAIL_OVERLAP + 对应测试），统一调度器成唯一路径（⛔ 失去 one-key rollback 安全网，需确认统一调度器已足够稳定）。
2. **标清 + 删误导注释**：保留 fallback（安全网），但把 legacy 代码/注释**明确标「legacy fallback only」**（尤其 `:1093`「serial ALONE」改标「legacy fallback；统一调度器下 serial∥lowconc∥main 并发」），并把 suite-params/runner-concurrency/full-suite-runner 里的 PHASE_OVERLAP/MAIN_TAIL_OVERLAP 标 legacy。

## Acceptance Criteria

- [x] AC1（能取假）：`scripts/test.sh:1093`「serial ALONE」注释不再误导——标明 legacy fallback（或 legacy 全删），统一调度器语义（serial∥lowconc∥main 并发）在注释里可见；（⛔ 仍有无标 legacy 的「ALONE/先跑」注释 ⇒ 假——复查补三处同形：`scripts/test.sh:1717`「serial runs sequentially BEFORE lowconc」bucket 路径、`scripts/test.sh:1387`「ALONE at its own concurrency」scoped `--group lowconc`、及 `:1093` 本体）。
- [x] AC2（能取假，一致性）：PHASE_OVERLAP / MAIN_TAIL_OVERLAP / run_selected 要么全删、要么全标 legacy——无「半退役半活」的中间态；（⛔ 残留未标 legacy 的分相引用 ⇒ 假）。

## Definition of Done

legacy 分相面（代码 + 注释 + 测试）统一清理或统一标 legacy；AC1/AC2 勾；无误导性「serial ALONE/先跑」注释；全量 suite 绿。

## Touches

- scripts/test.sh（legacy 分相路径退役/标 legacy + 删误导注释）
- plugin/scripts/suite-params.ts（PHASE_OVERLAP/MAIN_TAIL_OVERLAP 标 legacy）
- plugin/scripts/runner-concurrency.ts（QUAY_PHASE_OVERLAP 标 legacy）
- plugin/scripts/full-suite-runner.ts（PHASE_OVERLAP/A watcher 标 legacy）
- plugin/test/full-suite-runner-cgroup.test.mjs
- plugin/test/fan-in-execute-paths.test.mjs
- plugin/test/full-suite-runner-phases.test.mjs
- plugin/test/runner-concurrency.test.mjs
- plugin/test/select-tests-for-touches.test.mjs
- plugin/test/runner-grouping-flags-only.test.mjs
- plugin/test/suite-params.test.mjs
- plugin/test/resource-gate.test.mjs
- plugin/test/suite-speed-nested-skip.test.mjs
- plugin/test/test-phases-order.test.mjs
- plugin/test/runner-grouping-serial-anti-stomp.test.mjs
- plugin/test/suite-bucket-load-sensitive-isolation.test.mjs
- tasks/gap-suite-scheduler-legacy-phase-splitting-cleanup.md（自身）

## Needs-Human

**执行 2026-09-02T17:35:56.751Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red
- run_id：wk-prod-1788285192
- session_id：00debe21-0353-4bb1-8181-fd43e4c483e0
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-suite-scheduler-legacy-phase-splitting-cleanup~wk-prod-1788285192~1788369050329-c35f2f.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-suite-scheduler-legacy-phase-splitting-cleanup-wk-prod-1788285192.log

## Needs-Human

**执行 2026-09-03T00:21:08.550Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red
- run_id：wk-prod-1788285192
- session_id：b198c7df-6a5b-4856-ae61-3f243828bdd5
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-suite-scheduler-legacy-phase-splitting-cleanup~wk-prod-1788285192~1788394404735-bf8dba.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-suite-scheduler-legacy-phase-splitting-cleanup-wk-prod-1788285192.log
