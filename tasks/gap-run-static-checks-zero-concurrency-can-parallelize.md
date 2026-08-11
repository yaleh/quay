---
id: gap-run-static-checks-zero-concurrency-can-parallelize
title: run_static_checks 结构性零并发可并行化——scripts/test.sh:225 约 20+ 个 run_checker 顺序执行无 &/wait/xargs -P；各检查器只读独立无共享状态 ⇒ 并行化风险低于 serial 并发实验；本机/orangevps 只省 10-16s，但多核机器 run_static_checks_ms 直接暴露单核速度、随核数线性可省——核数优势能兑现的第五个位置
status: ready
labels:
  - gap
  - defect
  - performance
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**run_static_checks 是结构性零并发（manager 2026-08-11 10:5x，outer 复核确认）**：`scripts/test.sh:225 run_static_checks()` 内部约 **20+ 个 `run_checker` 调用逐行顺序执行，没有 `&`/`wait`/`xargs -P`，零并发机制**。这与 lowconc（有并发旋钮但被单文件钉死）不同——**overhead 是结构性零并发**。各检查器（test-isolation-check / task-contract-check / adr016-screen-use-check / tick-core-static-check 等）彼此独立、只读、无共享状态假设 ⇒ 并行化没有 serial 组 nested-spawn 那种进程膨胀顾虑，**风险低于 serial 并发实验**。

### 实证（manager 10:5x 拆四相核对 + outer 复核）

- **发现来源**：人在追问「boheidc 优化后为什么只快 45s 而不是 main 相单独就有的 77s」时拆四相逐一核对，overhead 相（含 static_checks/resource_gate/build_dist）boheidc 比 orangevps 慢 27.2s（43.2s vs 16.0s），占比接近单核速度比（2.77x，比 2.12x 单文件比略高）。
- **核实**：scripts/test.sh run_static_checks 20+ run_checker 顺序调用，零并发机制；各检查器只读独立。
- **收益量级**：本机/orangevps 只占约 10-16s，并行化收益不大；**多核机器（boheidc 16核及更大）上 run_static_checks_ms 直接暴露单核速度、随核数线性可省——核数优势能兑现的第五个位置**，不需等 serial/lowconc 两个已知杠杆。

### 建议形式（不写实现，给方向）

`xargs -P <N>` 或后台 `&`+`wait` 并行 `run_checker` 调用，N 可固定小数（如 4）或读 nproc。**需保留退出码收集与失败可见性**：当前顺序执行某检查失败会中止（fail-closed），并行化后不能让其失败被其他检查器输出掩盖；checker-cost.jsonl 每 exit 追加 + exit-code 传播是现成约束。

### 验证锚

修后 (a) run_static_checks 并行化、20+ 检查器并发执行；(b) 失败可见性不降——任一检查器失败仍 fail-closed 中止并可见（不被掩盖）；(c) checker-cost.jsonl 每 exit 追加仍完整；(d) `--for-task` scoped 门绿；(e) 全量套件不回归。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 run_static_checks 结构性零并发实证（20+ run_checker 顺序调用无并发机制）+ overhead 相 boheidc/orangevps 差（43.2s vs 16.0s）+ 检查器只读独立（本任务 Proposal 已含）
- [ ] AC2: **并行化**——run_checker 调用经 `xargs -P` 或 `&`+`wait` 并发执行（N 固定小数或读 nproc）
- [ ] AC3: **失败可见性不降**——任一检查器失败 fail-closed 中止并可见，不被其他检查器输出掩盖
- [ ] AC4: **成本记录完整**——checker-cost.jsonl 每 exit 追加不丢；`--for-task` scoped 门绿
- [ ] AC5: **全量不回归**——全量套件绿（外层 verification-round 验证）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：run_static_checks 并行化后 `*_phase_ms`（overhead/static_checks 项）对照贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- scripts/test.sh（run_static_checks：run_checker 调用并行化）
- plugin/scripts/checker-cost-lib.sh（成本记录约束——每 exit 追加不丢）
- plugin/test/measure-suite-reporter.test.mjs（若影响 per-file 报告接线）
- tasks/gap-suite-floor-two-longest-files-bound.md（交叉标注——第五个杠杆 Finding 落点）
- tasks/gap-run-static-checks-zero-concurrency-can-parallelize.md（自身：勾 AC + 贴证据）

## Contract

measure   static_checks_phase_ms = `grep -oE 'run_static_checks_ms=[0-9.]+' <套件日志> | tail -1` 的 stdout 中数字
band      static_checks_phase_ms 并行化后 ≤ 顺序基线（本机约 10-16s）的墙钟（N 路并发应更快或持平）
invariant checkers_all_still_fail_closed = 1（任一检查器失败仍中止可见，不被并发掩盖）
invariant cost_ledger_complete = 1（checker-cost.jsonl 每 exit 追加不丢）
invoke    `bash scripts/test.sh --for-task gap-run-static-checks-zero-concurrency-can-parallelize --allow-thin`（贴 scoped 门绿）
control   并行化不降失败可见性；成本记录完整；既有不回归
resume    并行化实现 / 失败可见性 / 成本记录 / scoped 门分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 10:5x——第五个杠杆：run_static_checks 结构性零并发（20+ run_checker 顺序无 &/wait/xargs -P），检查器只读独立、风险低于 serial 并发实验；本机只省 10-16s 但多核机器 run_static_checks_ms 线性可省（核数优势第五个位置）。形式：xargs -P 或 &+wait，需保留失败可见性（fail-closed 不掩盖）。实现归 inner，判定归 outer
