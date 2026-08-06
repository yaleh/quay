---
id: gap-no-criterion-records-its-own-cost-checker-cost-jsonl
title: "generator new axis: NO criterion records its own cost — the
  ready-pool-check slope 35.8s→91.2s in one hour (n 19→24, cost 2.55x while
  O(n2) predicts 1.6x) is ONLY visible because the manager hand-timed it twice;
  all 16 static checkers + 14 gates persist ZERO execution time
  (full-suite-state.json durationMs is the single exception and suite-level
  only) => criterion-cost DEGRADATION is completely invisible until a human
  hand-measures, and we just proved it can 2.5x in an hour; generator question:
  what range does a criterion's cost quantify? answer: nothing — no
  quantification; minimal viable: each criterion appends one line {name, ms, n}
  to .quay/checker-cost.jsonl on exit, pure-append zero-judgment, the trend
  grows itself; same time-axis as
  gap-quality-criteria-are-point-in-time-no-trend-criteria but the OBJECT is the
  criterion itself not the product — parallel item with cross-reference, NOT a
  sub-item (the checker-cost recording is the ENABLING mechanism for the whole
  criterion-cost family, incl the pool-check 91.2s instance); AC10: split two
  ways — the ready-pool slope is post-friction (manager only timed because outer
  skipped), does NOT score; 'no criterion records its own cost' is pre-friction
  (the other 29 criteria have nothing hurting), scores +1 => AC10 4->5"
status: ready
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
3. **pool-check 优先级裁定（提，随后更正——见第 5 点）**——斜率支撑下，`gap-ready-pool-floor...`
   的三条修法（③拆 O(n)/O(n²) 频率、②touches mtime 缓存、①增量）提为高优先；quality-criteria 实例
   #10 已记录斜率数据。
4. **AC10 记账（拆两半）**：
   - ready-pool 斜率 = **post-friction**（管理者只因为外层 skip 才去测）——**不计分**；
   - 「所有判据都不记成本」= **pre-friction**（另外 29 条判据没有任何东西在疼）——**计 +1 ⇒ 4 → 5**。
   - **跨引用（gap-suite-state-has-no-reason-axis-failed-aborted-infra AC6）**：suite-state 缺原因轴
     为同一根 pre-friction 轴的下一条——`state=red` 只一个值承载「这轮没成」，failed/aborted/infra-error
     对下游反应不同被压成标量，且发现时无东西在疼（巧合尚未破裂）——**计 +1 ⇒ 5 → 6**。AC10 总账见
     `gap-axis-generator-question-what-range-every-standing-criterion`（已完成，账上已列 → 6）。
5. **归因更正（管理者 2026-08-05 07:27Z，撤回第 3 点的优先级建议）**：ready-pool-check 第三次实测
   **157.0 秒**（pool 24 / floor 12 / disjoint 10 / scanned 702）。三点：06:44Z 35.8s(pool 19) →
   07:15Z 91.2s(pool 24) → 07:27Z 157.0s(pool 24)。**后两点 pool 完全相同、成本却涨 1.7 倍** ⇒ 主导
   变量不是池子大小，是**机器负载**（同期 load 30.91）。第 3 点的三条优化改的是 n 的系数，而成本增长
   几乎全来自负载——**先修负载（full-suite-runner laneCount 硬编码，见
   gap-no-resource-awareness-heavy-ops-run-blind re-open），这条判据大概率回到 36 秒量级**；先做那
   三条优化是在错误轴上花力气。**方法论教训（值得进任务体）**：两点不足以定斜率归因——必须有至少一个
   控制变量的点（本例 pool 相同的那两点才是决定性的）；缺的正是 **load 这一维**——如果每次判据执行都
   记 `{name, ms, n, load}`，这个归因错误一开始就不会发生。
6. **套件耗时序列并入（管理者 07:24Z，同一根轴扩对象）**：`.quay/full-suite-state.json` 是**单状态
   文件每轮覆盖**——上一轮 durationMs（872756ms=14.5min）已被覆盖没了；`.quay/verification-round.jsonl`
   只有 2 行、停在 05:03Z。今夜提交提 ROUND/full-suite/verification round 的有 71 条、单 ROUND 3 就
   跑了 7 次，但留下的可查耗时序列是【2 行且停在 2.5 小时前】。**没有历史的耗时指标等于没有指标**——
   人问「优化了什么/最好多快」只能靠手工从 pane 和提交信息捞数字。**修法与 checker-cost 同形**：追加
   `{round, startedAt, durationMs, laneCount, pass, fail, load}` 到 verification-round.jsonl（或
   checker-cost.jsonl），不覆盖单状态文件。**另查停写根因（外层已查）**：verification-round.jsonl 只
   能由外层步骤 1b 写，停在 05:03 = ROUND 3 期间每次收尾都被红窗卡住没走到写记录那步——**机制没死、
   是红窗让收尾没产出新轮次**；但「单文件覆盖 + 无序列」的缺陷独立成立。

## Acceptance Criteria

- [ ] AC1: **checker-cost.jsonl 纯追加**——每个判据退出时追加 `{name, ms, n, load}`（16 静态检查器 +
      14 闸门，至少覆盖 run_static_checks + gate 执行路径）；**load = /proc/loadavg 的 1min 值**——
      它是把「判据变慢」拆成「n 变大」和「机器变忙」的唯一手段（归因更正第 5 点）；纯追加零判断
      （无阈值无打标）
- [ ] AC2: **趋势自然长出**——连续 N 次运行后，从 checker-cost.jsonl 能读出 ready-pool-check 的成本
      + load 双维序列（35.8→91.2→157.0 三点可复现、且 pool 相同的那两点能看出 load 是主导变量；
      无需手工掐表）
- [ ] AC3: **与 quality-criteria 并列**——交叉标注（checker-cost 提供数据、quality-criteria 提供打标）；
      对象是判据自身（非产品面趋势）
- [ ] AC4: **pool-check 优先级（归因更正后）**——三条修法（③拆频/②缓存/①增量）**不先做**：主导变量是
      load 不是 n；先修 full-suite-runner laneCount 硬编码（`gap-no-resource-awareness-heavy-ops-run-blind`
      re-open），负载降后判据大概率回 36s 量级；三条修法降为「负载修复后再评估」
- [ ] AC5: **AC10 诚实记账（拆两半）**——ready-pool 斜率 post-friction 不计分；「判据不记成本」pre-friction
      计 +1 ⇒ 4 → 5
- [ ] AC6: **套件耗时序列并入**——追加 `{round, startedAt, durationMs, laneCount, pass, fail, load}` 到
      verification-round.jsonl（或 checker-cost.jsonl），**不覆盖单状态文件**；套件跑了几十轮必须留下
      可查耗时序列（ROUND 3 跑 7 次、序列停在 05:03 的缺陷消除）
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC2 实跑输出贴任务体（checker-cost.jsonl 读出 load 双维序列）
- [ ] 判据成本有记录（纯追加含 load）；套件耗时序列不再覆盖丢失；退化在被人手工发现前可见；
      pool-check 三条修法按归因更正降级（先修负载）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/（判据执行包装处加 time + load 记录 + checker-cost.jsonl 纯追加；full-suite-runner
  或 verification-round 写套件序列 {round, startedAt, durationMs, laneCount, pass, fail, load}）
- plugin/test/（AC2 斜率复现 fixture）
- tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.md（AC3 并列交叉标注 + 实例 #10 斜率已记）
- tasks/gap-ready-pool-floor-scales-with-cap-and-promotion-ranks-touch-disjointness.md（AC4 优先级标注）
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（AC5 记账引用）

## Contract

measure   checker_cost_rows = `wc -l .quay/checker-cost.jsonl` stdout 的数字段
band      checker_cost_rows = 随运行数增长（每判据退出 +1 行；纯追加零判断）
invariant cost_recording_is_append_only = 1（无阈值无打标——趋势是读它的被动判据）
invoke    `tail -5 .quay/checker-cost.jsonl`
control   构造 ready-pool-check 跑三次（35.8→91.2→157 序列）⇒ checker-cost.jsonl 出现三行含 load 的可读双维斜率（AC2）；pool 相同两点成本不同 ⇒ load 字段能区分（归因更正第 5 点）
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
