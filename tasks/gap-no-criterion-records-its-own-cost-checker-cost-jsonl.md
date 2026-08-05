---
id: gap-no-criterion-records-its-own-cost-checker-cost-jsonl
title: "generator new axis: NO criterion records its own cost — the ready-pool-check slope 35.8s→91.2s in one hour (n 19→24, cost 2.55x while O(n2) predicts 1.6x) is ONLY visible because the manager hand-timed it twice; all 16 static checkers + 14 gates persist ZERO execution time (full-suite-state.json durationMs is the single exception and suite-level only) => criterion-cost DEGRADATION is completely invisible until a human hand-measures, and we just proved it can 2.5x in an hour; generator question: what range does a criterion's cost quantify? answer: nothing — no quantification; minimal viable: each criterion appends one line {name, ms, n} to .quay/checker-cost.jsonl on exit, pure-append zero-judgment, the trend grows itself; same time-axis as gap-quality-criteria-are-point-in-time-no-trend-criteria but the OBJECT is the criterion itself not the product — parallel item with cross-reference, NOT a sub-item (the checker-cost recording is the ENABLING mechanism for the whole criterion-cost family, incl the pool-check 91.2s instance); AC10: split two ways — the ready-pool slope is post-friction (manager only timed because outer skipped), does NOT score; 'no criterion records its own cost' is pre-friction (the other 29 criteria have nothing hurting), scores +1 => AC10 4->5"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者 07:16Z tick（2026-08-05）——**生成器新轴：没有任何判据记录自己的成本**。

**斜率实例**：ready-pool-check 06:44Z 手测 35.8 秒 → 07:15Z 再测 **91.2 秒**。同期 pool 19 → 24。
n 涨 1.26×、成本涨 2.55×——比 O(n²) 只该给的 1.6× 还陡（或还有别的项、或机器负载也在涨）。**这条斜率
唯一可见的原因，是管理者手工掐了两次表。** 全仓 16 个静态检查器 + 14 个闸门，**没有一个把自己的执行
耗时落盘**；`full-suite-state.json` 记了 `durationMs`（唯一例外，且只记套件整体）。⇒ **单个判据的成本
零记录**——判据成本的退化在被人手工发现之前**完全不可见**，而我们刚证明它可以一小时内 2.5×。

**生成器问句**：判据的成本量化在什么范围？答案：**没有量化**——不是「眼前这一个」更不是「某根轴」，
而是**完全空着**。

**与 quality-criteria 的关系（管理者建议子项/并列项；外层裁定：并列）**：与
`gap-quality-criteria-are-point-in-time-no-trend-criteria` 是同一根时间轴，但**对象是判据自身**而不是
产品。**为何并列非子项**：checker-cost 记录是**整个判据成本族（含 pool-check 91.2s 实例）的启用机制**——
没有它，趋势判据只能从 suite-state 读套件整体成本，读不到单个判据；它是机制、不是又一条趋势实例。

### 选定机制（外层裁定：立案 + 与 quality-criteria 并列）

1. **checker-cost.jsonl 纯追加**——每个判据退出时追加一行 `{name, ms, n}` 到 `.quay/checker-cost.jsonl`；
   **纯追加、零判断**（不加阈值、不打标——那是趋势判据的事），趋势自然长出来。挂接点：判据的
   run_static_checks / gate 执行包装处（shell 包装 `time` 即可，无需改动判据内部）。
2. **与 quality-criteria 并列交叉标注**——quality-criteria 是「比上次更贵了吗」的产品面趋势；
   checker-cost 是「判据本身多贵」的机制面记录；两条互相引用（后者提供数据、前者提供打标）。
3. **pool-check 优先级裁定（提）**——斜率支撑下，`gap-ready-pool-floor...` 的三条修法（③拆 O(n)/O(n²)
   频率、②touches mtime 缓存、①增量）提为高优先；quality-criteria 实例 #10 已记录斜率数据。
4. **AC10 记账（拆两半）**：
   - ready-pool 斜率 = **post-friction**（管理者只因为外层 skip 才去测）——**不计分**；
   - 「所有判据都不记成本」= **pre-friction**（另外 29 条判据没有任何东西在疼）——**计 +1 ⇒ 4 → 5**。

## Acceptance Criteria

- [ ] AC1: **checker-cost.jsonl 纯追加**——每个判据退出时追加 `{name, ms, n}`（16 静态检查器 + 14 闸门，
      至少覆盖 run_static_checks + gate 执行路径）；纯追加零判断（无阈值无打标）
- [ ] AC2: **趋势自然长出**——连续 N 次运行后，从 checker-cost.jsonl 能读出 ready-pool-check 的成本斜率
      （35.8→91.2 序列可复现；无需手工掐表）
- [ ] AC3: **与 quality-criteria 并列**——交叉标注（checker-cost 提供数据、quality-criteria 提供打标）；
      对象是判据自身（非产品面趋势）
- [ ] AC4: **pool-check 优先级提**——`gap-ready-pool-floor...` 三条修法（③拆频/②缓存/①增量）标注高优先；
      斜率数据（35.8→91.2，n 1.26×/成本 2.55×）已入 quality-criteria 实例 #10
- [ ] AC5: **AC10 诚实记账（拆两半）**——ready-pool 斜率 post-friction 不计分；「判据不记成本」pre-friction
      计 +1 ⇒ 4 → 5
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC6 全部勾上；AC2 实跑输出贴任务体（checker-cost.jsonl 读出斜率）
- [ ] 判据成本有记录（纯追加）；退化在被人手工发现前可见；pool-check 修法优先级已提
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/（判据执行包装处加 time 记录 + checker-cost.jsonl 纯追加）
- plugin/test/（AC2 斜率复现 fixture）
- tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.md（AC3 并列交叉标注 + 实例 #10 斜率已记）
- tasks/gap-ready-pool-floor-scales-with-cap-and-promotion-ranks-touch-disjointness.md（AC4 优先级标注）
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（AC5 记账引用）

## Contract

measure   checker_cost_rows = `wc -l .quay/checker-cost.jsonl` stdout 的数字段
band      checker_cost_rows = 随运行数增长（每判据退出 +1 行；纯追加零判断）
invariant cost_recording_is_append_only = 1（无阈值无打标——趋势是读它的被动判据）
invoke    `tail -5 .quay/checker-cost.jsonl`
control   构造 ready-pool-check 跑两次（35.8→91.2 序列）⇒ checker-cost.jsonl 出现两行可读斜率（AC2）；quality-criteria 能从 checker-cost 读数据打标（AC3 负向验证）
resume    纯追加记录与挂接点分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T07:3xZ
changed: 外层受管理者 07:16Z tick 裁定立案（生成器新轴 + AC10 拆半）。四处收紧：
(1) **新轴坐实**——判据成本零记录（16 检查器 + 14 闸门全不落盘），35.8→91.2 斜率仅靠手工掐表可见；
    生成器问句答案 =「没有量化」；
(2) **并列非子项**——checker-cost 是判据成本族的启用机制（提供数据），quality-criteria 是打标面（读数据），
    两条互相引用；
(3) **pool-check 优先级提**——斜率支撑三条修法提高优先；
(4) **AC10 拆半**——ready-pool 斜率 post-friction 不计分；「判据不记成本」pre-friction 计 +1 ⇒ 4 → 5。
status: todo——判据自身成本不可见；排 ROUND 3 收尾后，高优先。
