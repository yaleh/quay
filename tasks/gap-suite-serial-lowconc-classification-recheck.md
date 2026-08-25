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

- [ ] AC1（能取假，33 主动验证）：33 个纯 S 的 serial/lowconc 文件各在主并发池独立重跑 N 次，记录稳定/不稳定；（⛔ 未主动跑 33 个 ⇒ 假）。
- [ ] AC2（能取假，结论落地）：据测量落方向 (a) 或 (b)（测出前不动任一方向）；（⛔ 无结论或先动后测 ⇒ 假）。

## Definition of Done

两条路径判断一致性结论落地；AC1/AC2 全勾；serial/lowconc 分相按结论统一（启用或停用），不再一条生效一条不生效。

## Touches

- 被主动验证的 @test-group serial/lowconc 文件（标注调整，如需）
- scripts/test.sh（如需按结论统一分相）
- plugin/scripts/suite-bucket-select.ts（如需按结论统一分相）
- tasks/gap-suite-serial-lowconc-classification-recheck.md（自身）