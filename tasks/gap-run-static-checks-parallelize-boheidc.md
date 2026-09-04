---
id: gap-run-static-checks-parallelize-boheidc
title: 杠杆③：scripts/test.sh:225 run_static_checks() 并行化（~20+
  个独立只读检查器逐行顺序执行，boheidc 多核未兑现核数优势；零风险独立于死锁）
status: superseded
labels:
  - gap
  - defect
  - suite-optimization
parent: null
children: []
extra: {}
---
---
id: gap-run-static-checks-parallelize-boheidc
title: "杠杆③：scripts/test.sh:225 run_static_checks() 并行化（~20+ 个独立只读检查器逐行顺序执行，boheidc 多核未兑现核数优势；零风险独立于死锁）"
status: superseded
role: primitive
labels:
  - gap
  - defect
  - suite-optimization
extra:
  schema: v1
---

**type:** execution

## Finding

（人 2026-08-12 直接裁定「boheidc Suite 测试优化方案」第 3 节杠杆③，原文转达）`scripts/test.sh:225 run_static_checks()` 内部约 20+ 个 run_checker 调用**逐行顺序执行，零并发机制**（无 &/wait/xargs -P）。在本机/orangevps 上收益不大（这部分只占 10-16s），但 boheidc 这类多核机器上是核数优势能兑现的额外位置——overhead 相在 boheidc 比 orangevps 慢 27.2s（43.2s vs 16.0s），接近单核速度比。

**各检查器**（test-isolation-check / task-contract-check / adr016-screen-off-check / tick-core-static-check 等）**彼此独立、无共享状态假设、都是只读检查**，不像 serial 组有 nested-spawn 进程膨胀顾虑。**零风险，独立于死锁问题，可立刻开工**。

## 修复方向（人给的实现方向，非最终方案——裁定归本任务执行者）

- `xargs -P <N>` 或后台 `&` + `wait`，N 可固定小数（如 4）或读 nproc。
- **退出码收集是硬要求**：当前顺序执行下某检查失败会中止；并行化后要保留同等的失败可见性——**不能让一个检查器失败被其他检查器输出掩盖**（每个检查器独立退出码 + 汇总）。

## AC

- [ ] `scripts/test.sh run_static_checks()` 的检查器并行执行（有真实并发机制，非顺序）
- [ ] 任一检查器失败仍导致 gate 失败（退出码可见性保留，无掩盖）
- [ ] overhead 相耗时在 boheidc 上下降（对比基线）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## DoD

- [ ] 全量套件绿（外层 verification-round 验证）
- [ ] run_static_checks 并行化落地且失败可见性保留

## Touches

- scripts/test.sh
- plugin/test/test-framework-policy-check.test.mjs（如涉及）

## Evidence

- `scripts/test.sh:225 run_static_checks()`（顺序 run_checker 循环）
- 人 2026-08-12 方案（boheidc Suite 测试优化，第 3 节杠杆③）

## Superseded (2026-08-12 06:5xZ)

已由 inner commit fecb2fbd（2026-08-11T17:24Z）实现落地：scripts/test.sh:244-252 RUN_CHECKER_PARALLEL=1 + STATIC_CHECK_CONCURRENCY（默认 nproc）+ run_checker_parallel_wait（fail-closed）。本任务重复，作废。
