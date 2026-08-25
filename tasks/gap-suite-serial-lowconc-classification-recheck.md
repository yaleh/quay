---
id: gap-suite-serial-lowconc-classification-recheck
title: serial/lowconc 降并发两条路径判断不一致——--buckets 未启用分相（33 主动验证）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

serial+lowconc 两阶段合计吃掉 full-bucket suite 真实执行时间 ~50%（8h 12 轮：serial 25% + lowconc 25%）——标 `@test-group serial`/`lowconc` 的文件跑降并发（`nproc/(S×P)`）。**定性修正（manager 逐条核实，人裁定「发」）：不是「分类过时」，是「同一套判断在两条路径上一条生效一条不生效」**：

**① 降并发的真实理由（`scripts/test.sh:70-96`，与 S 无关）**：serial(并发1)=嵌套启动 suite / 真实墙钟等待 A/B + real-install/quay-init 家族（后者 round 162 因全量负载下「轮着 flaky」才并入）；lowconc(并发3)=hermetic 但负载敏感的 session-observation 家族（私有 socket + 墙钟等待）。⇒ 它们敏感的是**墙钟超时与独占资源**，不是 CPU。

**② 这套保护在当前主要派发路径 `--buckets` 上根本没启用**：`suite-bucket-select.ts` + `suite-lpt-runner.mjs` 全文无 `test-group` 字样，serial/lowconc 文件在 bucket 跑里 concurrency=16 裸跑，且历史 120 轮 fail=0。⇒ 两条路径判断不一致。

**③ S 的双重身份**：S 定义 = `scripts/test.sh` 本身；静态引用 test.sh 的文件 bucket-set={S} ⇒ 任何 P-only/M-only 改动都选不中它（96 纯 S 只能走 full 的根因）。

**④ `@test-group` 分相与 bucket 分类是两套正交机制**：纯 S 文件 @test-group 标签五花八门——「S 分类」与「低并发」无因果。

**⑤ 数量更正 + 收窄**：serial/lowconc 文件 61 个。其中 27 个有生产证据（含 stage-receipt 41 次 bucket-path fail=0）已另立任务直接移出（`gap-suite-move-27-evidenced-files-out-serial-lowconc`）。剩余 **33 个纯 S 无证据**（结构性永不被 bucket 跑选中，只能主动验证）+ 0 待观察。

**⑥ 量化结论（manager 8h 模拟）**：分相移除是**单项最大软件杠杆**——full 去 serial/lowconc 分相（1.74→1.2）→ **16.2%** 缩减；与拆文件（2.8%）合 19.0%；再加 32 核 → 51.8%（超加性多 13pp）。⇒ 分相税就是挡多核收益的墙，本任务（两条路径统一）是最大软件杠杆，**顺序不可反**（先软件，同样 32 核钱多值 ~62%）。

## Plan

33 个纯 S 的 serial/lowconc 文件主动跑验证（主并发池 N 次重跑记录稳定）。据结果落方向——(a) 让 `--buckets` 也尊重分相，或 (b) 确认新条件下不需要、两条路径一起停用。⛔ 测出结论前不朝任一方向动。

## Acceptance Criteria

- [x] AC1（能取假，33 主动验证）：33 个纯 S 的 serial/lowconc 文件各在主并发池独立重跑 N 次，记录稳定/不稳定；（⛔ 未主动跑 33 个 ⇒ 假）。
- [x] AC2（能取假，结论落地）：据测量落方向 (a) 或 (b)（测出前不动任一方向）；（⛔ 无结论或先动后测 ⇒ 假）。

## Measurement（AC1 证据）

33 个纯 S 文件在【主并发池】整体重跑 N=5 轮（concurrency=16 = 主并发池 `default_test_concurrency`）。`QUAY_TEST_NESTED=1` + `QUAY_TEST_NESTED_ROOT=<worktree>` 复刻 full-suite/bucket 路径的嵌套环境——**缺它会出测量伪影**：nested-spawn 文件（runner-grouping-*）的嵌套 `scripts/test.sh` 会重跑静态检查、撞测试自身的 120s `spawnSync` 超时（首轮 3 个假 UNSTABLE 即此因，已修 harness 重测）。逐轮 perFile 记录：

| 轮 | exit | pass | fail | wall_ms |
|---|---|---|---|---|
| 1 | 0 | 33 | 0 | 186354 |
| 2 | 0 | 33 | 0 | 152903 |
| 3 | 0 | 33 | 0 | 160698 |
| 4 | 0 | 33 | 0 | 160310 |
| 5 | 0 | 33 | 0 | 164619 |

⇒ **33 文件 × 5 轮 = 165 次独立 file-run，0 fail，全部 STABLE**（测量期并有机上其它在飞 suite 的真实负载）。无文件在主并发池重跑中不稳定。

## Conclusion（AC2 落方向）

33 个纯 S 文件在主并发池 5 轮 165 次全稳定 ⇒ **不需要 serial/lowconc 降并发分相**。落方向 **(b)**：确认新条件下不需要、两条路径一起停用——33 文件 `@test-group` 由 serial/lowconc 改为默认组 `engine`（主并发池）。`--buckets` 路径本就未启用分相（从不降并发）⇒ 两条路径对这 33 文件的并发判断一致（都跑主并发池）。

保留各文件的 `@load-sensitive` 标注（`known-load-sensitive.ts` 的 fix-scope deferral 用，与 `@test-group` 分相正交，不改）。剩余 27 个有证据文件由 `gap-suite-move-27-evidenced-files-out-serial-lowconc` 独立移出（不在本任务范围）；其移出后 serial/lowconc 分相为空（两任务合起来 = 分相停用）。

## Definition of Done

两条路径判断一致性结论落地；AC1/AC2 全勾；serial/lowconc 分相按结论统一（启用或停用），不再一条生效一条不生效。

## Touches

- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/capability-catalog.test.mjs
- plugin/test/checker-cost.test.mjs
- plugin/test/cold-start-skill.test.mjs
- plugin/test/fan-in-execute-paths.test.mjs
- plugin/test/fan-in-ff-executor-check.test.mjs
- plugin/test/monitor-mount-check.test.mjs
- plugin/test/per-task-suite-record-check.test.mjs
- plugin/test/quay-init-drift-report.test.mjs
- plugin/test/quay-init-laydown-closure.test.mjs
- plugin/test/quay-init-laydown-dist-closure.test.mjs
- plugin/test/quay-init-loop-consumer-doc-refs.test.mjs
- plugin/test/quay-init-loop-core.test.mjs
- plugin/test/quay-init-tmux-detection.test.mjs
- plugin/test/quay-init.test.mjs
- plugin/test/runner-grouping-fixture-runs.test.mjs
- plugin/test/runner-grouping-flags-only.test.mjs
- plugin/test/runner-grouping-governance.test.mjs
- plugin/test/runner-grouping-list-groups.test.mjs
- plugin/test/runner-grouping-serial-anti-stomp.test.mjs
- plugin/test/runtime-landing.test.mjs
- plugin/test/select-tests-for-touches.test.mjs
- plugin/test/session-liveness-events.test.mjs
- plugin/test/session-liveness-heartbeat.test.mjs
- plugin/test/session-liveness-signals-integration.test.mjs
- plugin/test/session-liveness-signals-kinds.test.mjs
- plugin/test/session-liveness-signals-thresholds-edge.test.mjs
- plugin/test/session-liveness-signals-thresholds-observers.test.mjs
- plugin/test/session-liveness-signals-thresholds.test.mjs
- plugin/test/session-liveness-sweep.test.mjs
- plugin/test/session-liveness-target.test.mjs
- plugin/test/session-topology.test.mjs
- plugin/test/threshold-scope-check.test.mjs
- tasks/gap-suite-serial-lowconc-classification-recheck.md（自身）