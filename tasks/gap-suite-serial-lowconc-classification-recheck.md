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

- [ ] AC1（能取假，33 主动验证）：33 个纯 S 的 serial/lowconc 文件各在主并发池独立重跑 N 次，记录稳定/不稳定；（⛔ 未主动跑 33 个 ⇒ 假）。
- [ ] AC2（能取假，结论落地）：据测量落方向 (a) 或 (b)（测出前不动任一方向）；（⛔ 无结论或先动后测 ⇒ 假）。
- [ ] AC3（能取假，单飞锁接入 --buckets）：bucket-scoped 成功路径（选中 M/P 文件、非 hub-touch、非 0 文件）也调用 `full_suite_lock_acquire`，`QUAY_MAX_CONCURRENT_SUITES=1` 对 `--buckets` 生效；（⛔ 正常路径仍跳过锁 ⇒ 假）。行为负控制：bucket 跑 round 记录含 `lock_wait_ms` 键（真 acquire 才写，缺键=没走锁路径）；或并发两 bucket 套件时第二个 `lock_wait_ms>0` 等锁。

## Definition of Done

两条路径判断一致性结论落地（分相）+ 单飞锁对 `--buckets` 生效（bucket-scoped 成功路径调 `full_suite_lock_acquire`）；AC1/AC2/AC3 全勾；serial/lowconc 分相按结论统一（启用或停用），不再一条生效一条不生效；`QUAY_MAX_CONCURRENT_SUITES=1` 对 `--buckets` 正常路径不再失效。

## Touches

- 被主动验证的 @test-group serial/lowconc 文件（标注调整，如需）
- scripts/test.sh（分相统一 + `full_suite_lock_acquire`/`run_selected` 锁获取抽出共用）
- plugin/scripts/suite-bucket-select.ts（如需按结论统一分相）
- plugin/scripts/suite-lpt-runner.mjs（如需按结论统一分相）
- tasks/gap-suite-serial-lowconc-classification-recheck.md（自身）