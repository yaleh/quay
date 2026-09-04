---
id: gap-suite-pure-execution-900s-optimization
title: full-bucket 纯执行时间超 900s（人裁触发条件已成立，4/6 轮 998.5–1224.5s）——触发测试优化
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

> **⛔ 暂持 needs-human（2026-08-26）**：AC1 依赖四个上游落地后重取基线，但 `depends_on:` 对 worker 派发结构上不生效（`slot-refill.ts` depsReadyFor 只读 parent、不读 depends_on——与 `ready-pool-check.ts` 同名函数语义不一致，manager 读码核实）⇒ 用 needs-human 作唯一生效的闸（promotion-driver 不自动晋 needs-human）。四个上游（gap-retire-governance-group-merge-into-bucket / gap-suite-serial-lowconc-classification-recheck / gap-suite-move-27-evidenced-files-out-serial-lowconc / gap-suite-split-long-multi-test-files）全部落地后，由 outer 翻回 ready。

## Proposal

人 2026-08-26 逐字裁定（正本在 gap-retire-governance-group-merge-into-bucket AC5）：「等锁时间不计入上述预算。在此前提下，full bucket 可以放宽到 900s。超过就应当触发测试优化。」⇒ 900s 是 **full-bucket 纯执行时间**（durationMs − lock_wait_ms，等锁明确不计入），作为「测试优化」的**触发点**而非 fail-closed 硬闸。

**触发条件已成立（manager 08-26 实测，4/6）**：最近 6 个 full-bucket 轮已有 4 个纯执行超 900s——`612:1149.6 / 614:1224.5 / 615:1070.4 / 619:998.5`（620:848.1 / 621:880.6 未超）。套件结构性欠并行（effective_parallelism 5.54/16，serial+lowconc 占墙钟 34%），纯执行时间本身已撞线。

⛔ **移动基线警示**：该 4/6 读数在三个 suite-优化任务（serial-lowconc-recheck / move-27-evidenced-files / split-long）落地【前】；且 governance 退役（gap-retire-governance-group-merge-into-bucket）会把 33–39 文件加进全量轮 ⇒ 优化前须重取一次纯执行基线，⛔ 不得拿落地前 4/6 当落地后结论（硬规则 4b 代理量 + 硬规则 5b 局部完备）。

## Plan

1. 待 gap-suite-serial-lowconc-classification-recheck、gap-suite-move-27-evidenced-files-out-serial-lowconc、gap-suite-split-long-multi-test-files、gap-retire-governance-group-merge-into-bucket 四者落地后，重取 full-bucket 纯执行基线（durationMs − lock_wait_ms）。
2. 若仍 > 900s：定位纯执行大头（serial+lowconc 相 / 单文件长尾 / 主池欠并行），做针对性优化。
3. 若已 ≤ 900s：记录负控制证据（落地后真轮读数），本任务 close（AC2 用负控制判）。

## Acceptance Criteria

- [ ] AC1（能取假，触发条件复核）：四个上游任务落地后重取 full-bucket 纯执行基线；≤900s ⇒ 记录负控制证据并 close，>900s ⇒ 进入优化；（⛔ 拿落地前 4/6 当落地后结论 ⇒ 假）。
- [ ] AC2（能取假，优化落地或负控制）：>900s 时落地针对性优化使 ≥1 个 full-bucket 轮纯执行 ≤900s；≤900s 时以落地后真轮读数作负控制 close；（⛔ 既无优化落地、又无负控制读数 ⇒ 假）。

## Definition of Done

触发条件复核 + 必要时优化落地；AC1-AC2 全勾；full-bucket 纯执行 ≤900s 有实测记录（或负控制 close 有记录）。

## Touches

- tasks/gap-suite-pure-execution-900s-optimization.md（自身）
