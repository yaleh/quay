---
id: gap-suite-serial-lowconc-classification-recheck
title: serial/lowconc 降并发 + 单飞锁两路径判断不一致——--buckets 绕过 run_selected（分相 + 锁全失效，33 主动验证）
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

**⑦ 统一收口（人 2026-08-25 裁定「统一收口，不分开修」）**：与 serial/lowconc 分相同根的第二个缺口——**单飞锁 `full_suite_lock_acquire()` 同样只挂在 `run_selected()` 里**（`scripts/test.sh:881`），`--buckets` 正常路径（选中 M/P 文件、非 hub-touch `:1381`、非 0 文件 `:1386`）结构上跳过 `run_selected` ⇒ 跳过锁。实证 round #572 M 桶 `lock_wait_ms` 键缺失（该键只在真 acquire 时写），与 #573 full 全程重叠 5 分钟。⇒ `QUAY_MAX_CONCURRENT_SUITES=1` 对 --buckets 从设计上没接进去——不是 flock 失效，是这条路径压根没调获取锁的函数。**两者是同一个结构问题**：--buckets 正常成功路径完全绕开 run_selected()，挂在该函数里的保护（分相 + 锁）对它全部失效。本任务统一修复两者。**根因修复落本任务；`gap-suite-concurrent-session-liveness-cross-contamination` 的 ② 前缀隔离是已完成的 defense-in-depth（症状级防御，非根因），与本任务不重复、互为补充。**

## Plan

**分相侧（原有）**：33 个纯 S 的 serial/lowconc 文件主动跑验证（主并发池 N 次重跑记录稳定）。据结果落方向——(a) 让 `--buckets` 也尊重分相，或 (b) 确认新条件下不需要、两条路径一起停用。⛔ 测出结论前不朝任一方向动。

**单飞锁侧（新增，与分相方向独立，不等待 33 验证结论）**：让 bucket-scoped 成功路径也调用 `full_suite_lock_acquire()`——把锁获取从 `run_selected()` 抽出给两条路径共用（或让 `--buckets` 也走 `run_selected` 的锁子逻辑），使 `QUAY_MAX_CONCURRENT_SUITES=1` 对 `--buckets` 正常路径生效。具体形态据代码结构定（抽出共用 vs 复走 run_selected）。

## Acceptance Criteria

- [x] AC1（能取假，33 主动验证）：33 个纯 S 的 serial/lowconc 文件各在主并发池独立重跑 N 次，记录稳定/不稳定；（⛔ 未主动跑 33 个 ⇒ 假）。
- [x] AC2（能取假，结论落地）：据测量落方向 (a) 或 (b)（测出前不动任一方向）；（⛔ 无结论或先动后测 ⇒ 假）。
- [x] AC3（能取假，单飞锁接入 --buckets）：bucket-scoped 成功路径（选中 M/P 文件、非 hub-touch、非 0 文件）也调用 `full_suite_lock_acquire`，`QUAY_MAX_CONCURRENT_SUITES=1` 对 `--buckets` 生效；（⛔ 正常路径仍跳过锁 ⇒ 假）。行为负控制：bucket 跑 round 记录含 `lock_wait_ms` 键（真 acquire 才写，缺键=没走锁路径）；或并发两 bucket 套件时第二个 `lock_wait_ms>0` 等锁。

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

## Conclusion（AC2 落方向，经 full-suite 修订）

初测方向 (b)（33 文件移 engine）**被 full-suite 验证推翻**。根因是 AC1 的方法论缺陷：`独立重跑`（每文件单跑，无并发无负载）测不出 `@load-sensitive` 文件的负载敏感——负载敏感只在全量并发 + 高机器负载下显现（同 `runner-grouping-serial-anti-stomp` 的「individual runs have no concurrency」）。

**full-suite 实证（fan-in 4 轮连红）**：`@load-sensitive` 文件在 engine 并发(16)高负载下——① `session-liveness-signals-kinds`（wall-clock）194s RESUMED 未触发（墙钟超时）；② `session-liveness-sweep`（wall-clock）+ `quay-init-tmux-detection`（real-install）tmux 服务器泄漏（独占资源，reap-wait 40s 后仍残留）。这些正是 Proposal ① 指出的「敏感于墙钟超时与独占资源」的家族。

**修订后结论**：26 个 `@load-sensitive` 文件（session-liveness 族 + quay-init/real-install 族 + nested-spawn/child-spawn）**回退原 serial/lowconc 组**——它们的 `@load-sensitive` 标注即降并发理由，分相不能停用。direction (b) 只对 **5 个非 load-sensitive 文件**成立（capability-catalog、fan-in-execute-paths、fan-in-ff-executor-check、per-task-suite-record-check、session-topology），这 5 个留 engine。`runner-grouping-serial-anti-stomp` 已在前轮回退 serial。**`monitor-mount-check` 原列「6 个非 load-sensitive」中，被 fan-in 全量 suite 证伪**（AC7 zero-write 测试 `git status --short` 前后快照在 engine 并发 16 下与并发仓库写入竞态 ⇒ 红），**回退 `@test-group lowconc`**——它是 B-class session-observation 族（spawn 真实 monitor 进程），AC1 的「独立重跑」测不出这类并发敏感（同本结论第一段的方法论缺陷）。

**⛔ 残留（direction (a) 未实现，需后续任务）**：分相被保留后，「full 路径尊重分相、`--buckets` 非 full 路径仍不尊重分相」的不一致**复现**——`--buckets` 成功路径走 `suite-lpt-runner.mjs` 以 `bucket_test_concurrency` 裸跑，不按 `@test-group serial/lowconc` 降并发。方向 (b)（移空分相）是错误的「解决」；正确方向是 **(a)**：让 `--buckets` 也尊重分相（把 serial/lowconc 文件抽出按低并发跑），与 AC3 的单飞锁同根（都是 `--buckets` 绕过 `run_selected()`）。本任务只落 AC3 + 回退 load-sensitive 文件；direction (a) 的 `--buckets` 分相接线是独立后续任务。

## AC3 落点（单飞锁接入 --buckets）

`scripts/test.sh` 的 `--buckets` 成功路径（`full=0` 且 `--paths-only` 非空，即走 `suite-lpt-runner.mjs` 的分支）在 `run_static_checks` 之前插入 `full_suite_lock_acquire` —— 该路径结构上绕过 `run_selected()`（`full_suite_lock_acquire` 原本只挂在那里），故 `QUAY_MAX_CONCURRENT_SUITES=1` 对 bucket 跑从不生效。插入点在 `mark_nested` 之前 ⇒ 顶层 bucket 跑会真 acquire（`full_suite_lock_acquire` 自带的 `QUAY_TEST_SKIP_RESOURCE_GATE`/嵌套 guard 仍生效）；FD 式 flock 随 `exit "${bucket_code}"` 自动释放，无需显式 release。负控制：bucket 跑现在会真 acquire ⇒ 写 `__OVERHEAD__ lock_wait_ms` 行（fan-in 的 step 4.5 per-task-suite 入账据此记录 `lock_wait_ms` 键，缺键=没走锁路径）。

## Definition of Done

两条路径判断一致性结论落地（分相）+ 单飞锁对 `--buckets` 生效（bucket-scoped 成功路径调 `full_suite_lock_acquire`）；AC1/AC2/AC3 全勾；serial/lowconc 分相按结论统一（启用或停用）——26 个 load-sensitive 留组 + 5 个非敏感移 engine 已落，「`--buckets` 路径分相接线（direction (a)）」为独立后续工作（0 失败 latent，硬规则 12 不阻塞本任务，见 Conclusion「⛔ 残留」）；`QUAY_MAX_CONCURRENT_SUITES=1` 对 `--buckets` 正常路径不再失效。

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
- scripts/test.sh（分相统一 + `full_suite_lock_acquire`/`run_selected` 锁获取抽出共用）
- plugin/test/known-load-sensitive.test.mjs（AC3 快照随 direction (b) 更新：3 个 ex-serial/lowconc 文件改断言 engine lane）
- tasks/gap-suite-serial-lowconc-classification-recheck.md（自身）