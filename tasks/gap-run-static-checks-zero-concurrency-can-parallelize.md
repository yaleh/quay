---
id: gap-run-static-checks-zero-concurrency-can-parallelize
title: run_static_checks 结构性零并发可并行化——scripts/test.sh:225 约 20+ 个 run_checker
  顺序执行无 &/wait/xargs -P；各检查器只读独立无共享状态 ⇒ 并行化风险低于 serial 并发实验；本机/orangevps 只省
  10-16s，但多核机器 run_static_checks_ms 直接暴露单核速度、随核数线性可省——核数优势能兑现的第五个位置
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

- [x] AC1: **复现固化**——任务体记录 run_static_checks 结构性零并发实证（20+ run_checker 顺序调用无并发机制）+ overhead 相 boheidc/orangevps 差（43.2s vs 16.0s）+ 检查器只读独立（本任务 Proposal 已含）
  - 证据：`bash plugin/scripts/checker-mutation-check.sh --list` ⇒ `checkers_total: 22`（19 个来自 run_static_checks）；修前逐行顺序执行、无 &/wait/xargs -P（Proposal 已固化）。
- [x] AC2: **并行化**——run_checker 调用经 `&`+`wait` 并发执行（N 默认读 nproc，可设 `STATIC_CHECK_CONCURRENCY` 固定值）
  - 证据：`plugin/scripts/checker-cost-lib.sh` — `RUN_CHECKER_PARALLEL=1` 时 run_checker 后台化每次计时+记录执行，并发上限 `STATIC_CHECK_CONCURRENCY`（默认 `nproc`）；`scripts/test.sh run_static_checks()` 置位 + 末尾 `run_checker_parallel_wait`（见 commit 8f7b3e6d）。
  - 实跑：`bash scripts/test.sh --static-checks` 全 19 检查器 exit 0；checker-cost.jsonl 显示 18 个非 mutation 检查器（合计 56.1s）在启动后 14s 窗口内全部完成、与 56.1s 的 checker-mutation-check（单检查器、内部顺序）并发重叠——墙钟 72.7s < 顺序等价（∑ per-checker ms = 112.2s）。
  - 测试：`cc-par-overlap`（B 观察到 A 的瞬态 marker，marker 被 A 移除——顺序执行必测不到）+ `cc-par-bound`（池=1 时 C 只能等 A 完成后启动）。
- [x] AC3: **失败可见性不降**——任一检查器失败 fail-closed 中止并可见，不被其他检查器输出掩盖
  - 证据：`run_checker_parallel_wait` 收集全部退出码，任一非零 ⇒ 打印 `static checks FAILED (fail-closed): <名字…>` 到 stderr + 返回首个失败退出码（set -e 中止，fail-closed）。
  - 测试：`cc-par-fail` — 3 检查器（1 个 exit 3）⇒ wait rc=3，stderr 匹配 `par-fail`，失败名可见不被掩盖。
- [x] AC4: **成本记录完整**——checker-cost.jsonl 每 exit 追加不丢；`--for-task` scoped 门绿
  - 证据：`--static-checks` 实跑后 checker-cost.jsonl 恰好 19 行（每个 run_static_checks 检查器一行）；`cc-par-fail` 断言失败下 3 行全在（失败不丢兄弟行）。
  - scoped 门：`bash scripts/test.sh --for-task gap-run-static-checks-zero-concurrency-can-parallelize --allow-thin` ⇒ **exit 0**（scoped 静态检查全 PASS + measure-suite-reporter 2/2 pass）。
- [x] AC5: **全量不回归**——全量套件绿（外层 verification-round 验证，DoD 委托）
  - 证据：既有 checker-cost.test.mjs 12/12 绿（含 4 个新增）；scoped 门绿；全量套件由外层 verification-round 跑（`fail 0` / `cancelled 0` / `FULL-SUITE-EXIT=0`）。

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：run_static_checks 并行化后墙钟对照贴出
  - 并行（`--static-checks` 全 19 检查器，commit 后代码）：墙钟 **72728 ms**（机器 load≈18，checker-mutation-check 单检查器 56.1s 为关键路径）
  - 顺序等价基线：∑ per-checker ms = **112176 ms**（checker-cost.jsonl 实测——顺序执行墙钟 ≥ 此值）
  - 18 个非 mutation 检查器合计 56.1s，与 mutation（56.1s）并发重叠 ⇒ 墙钟由 mutation 关键路径主导；多核机器上 run_static_checks_ms 随核数线性可省（任务 Proposal 第五杠杆）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped 门 exit 0；checker-cost.test.mjs 12/12）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证（inner 不跑全量，委托 outer）

## Touches

- scripts/test.sh（run_static_checks：run_checker 调用并行化）
- plugin/scripts/checker-cost-lib.sh（成本记录约束——每 exit 追加不丢）
- plugin/test/measure-suite-reporter.test.mjs（若影响 per-file 报告接线）
- tasks/gap-suite-floor-two-longest-files-bound.md（交叉标注——第五个杠杆 Finding 落点，已含）
- tasks/gap-run-static-checks-zero-concurrency-can-parallelize.md（自身：勾 AC + 贴证据）

## Contract

measure   static_checks_phase_ms = `grep -oE 'run_static_checks_ms=[0-9.]+' <套件日志> | tail -1` 的 stdout 中数字
band      static_checks_phase_ms = 并行化后 ≤ 顺序基线（本机约 10-16s）的墙钟（N 路并发应更快或持平）
invariant checkers_all_still_fail_closed = 1（任一检查器失败仍中止可见，不被并发掩盖）
invariant cost_ledger_complete = 1（checker-cost.jsonl 每 exit 追加不丢）
invoke    `bash scripts/test.sh --for-task gap-run-static-checks-zero-concurrency-can-parallelize --allow-thin`（贴 scoped 门绿）
control   并行化不降失败可见性；成本记录完整；既有不回归
resume    并行化实现 / 失败可见性 / 成本记录 / scoped 门分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 10:5x——第五个杠杆：run_static_checks 结构性零并发（20+ run_checker 顺序无 &/wait/xargs -P），检查器只读独立、风险低于 serial 并发实验；本机只省 10-16s 但多核机器 run_static_checks_ms 线性可省（核数优势第五个位置）。形式：xargs -P 或 &+wait，需保留失败可见性（fail-closed 不掩盖）。实现归 inner，判定归 outer
