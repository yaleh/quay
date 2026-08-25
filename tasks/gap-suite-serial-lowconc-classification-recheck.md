---
id: gap-suite-serial-lowconc-classification-recheck
title: serial/lowconc 降并发两条路径判断不一致——--buckets 未启用分相（33 主动验证 + 1 被动观察）
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

**① 降并发的真实理由（`scripts/test.sh:70-96`，与 S 无关）**：serial(并发1)=嵌套启动 suite / 真实墙钟等待 A/B + real-install/quay-init 家族（后者 round 162 因全量负载下「轮着 flaky」才并入，rounds 160/161/162 每轮红一个不同文件）；lowconc(并发3)=hermetic 但负载敏感的 session-observation 家族（私有 socket + 墙钟等待）。⇒ 它们敏感的是**墙钟超时与独占资源**，不是 CPU——「我等 5 秒应看到 X」超时，不是算不过来。这解释了 round #560：这些文件跑队列头时负载只有峰值一半，它们本来就不吃 CPU、在等。

**② 这套保护在当前主要派发路径 `--buckets` 上根本没启用**：`suite-bucket-select.ts` + `suite-lpt-runner.mjs` 全文无 `test-group` 字样，serial/lowconc 文件在 bucket 跑里 concurrency=16 裸跑，且历史 120 轮 fail=0。⇒ 两条路径判断不一致。

**③ S 的双重身份（解释「96 个纯 S 文件只能走 full」）**：S 定义 = `scripts/test.sh` 本身（`suite-bucket-attribution.ts:61`）；`HUB_FILES` 首项即 test.sh ⇒ 触碰即 bucket_full=1（正当：选择器被改不能用它挑出的子集验证它，fail-closed）。但 S 还有第二重身份：一个测试文件静态引用 `scripts/test.sh`（它测的就是 test.sh 行为）⇒ bucket-set={S} ⇒ 任何 P-only/M-only 改动都选不中它。

**④ `@test-group` 分相与 bucket 分类是两套正交机制**：纯 S 文件 @test-group 标签五花八门（tmux-isolated=governance / resource-gate=engine / session-liveness-events=lowconc / full-suite-runner=governance / capability-catalog=lowconc）——「S 分类」与「低并发」无因果。

**⑤ 数量更正 + 拆两段（`effectiveBucketSet` 对 434 测试文件普查）**：serial/lowconc 文件是 **61 个**（非 63——宽松 grep 混进 2 个正文提 serial/lowconc、实为 `@test-group engine`：`known-load-sensitive.test.mjs`、`test-coverage-check.test.mjs`）。其中 **33 个精确命中纯 S 名单**（结构性永不被 bucket 跑选中，等不到自然曝光，只能主动跑验证）；**仅 1 个例外** `experiments/quay-perpetual-stream/test/stage-receipt.test.mjs`（bucket-set=M+S，理论上一次 M-only 改动可选中，3 天窗口恰好没遇上 ⇒ 频率缺口，可被动等）。全库分布：M 190 / P 104 / 纯S 96 / M+P 14 / UNRESOLVED 9 / M+S 8 / P+S 7 / M+P+S 6。

## Plan

据 ⑤ 拆两段：33 个纯 S 的 serial/lowconc 文件主动跑验证（主并发池 N 次重跑记录稳定）；1 个 M+S 的 stage-receipt 被动观察。据结果落方向——(a) 让 `--buckets` 也尊重分相，或 (b) 确认新条件下不需要、两条路径一起停用。⛔ 测出结论前不朝任一方向动。

## Acceptance Criteria

- [ ] AC1（能取假，33 主动验证）：33 个纯 S 的 serial/lowconc 文件各在主并发池独立重跑 N 次，记录稳定/不稳定；（⛔ 未主动跑 33 个 ⇒ 假）。
- [ ] AC1b（能取假，1 被动观察）：`stage-receipt.test.mjs`（M+S）记录「被动等 M-only 自然曝光」或主动验证结果；（⛔ 无记录 ⇒ 假）。
- [ ] AC2（能取假，结论落地）：据测量落方向 (a) 或 (b)（测出前不动任一方向）；（⛔ 无结论或先动后测 ⇒ 假）。

## Definition of Done

两条路径判断一致性结论落地；AC1/AC1b/AC2 全勾；serial/lowconc 分相按结论统一（启用或停用），不再一条生效一条不生效。

## Touches

- 被主动验证的 @test-group serial/lowconc 文件（标注调整，如需）
- scripts/test.sh（如需按结论统一分相）
- plugin/scripts/suite-bucket-select.ts（如需按结论统一分相）
- plugin/test/...（对应测试，如需）
- tasks/gap-suite-serial-lowconc-classification-recheck.md（自身）