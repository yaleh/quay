---
id: gap-suite-serial-lowconc-classification-recheck
title: serial/lowconc load-sensitive 分类复核——占 50% full-bucket 时间，抽查是否过时
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

`scripts/test.sh` 里 serial+lowconc 两阶段合计吃掉 full-bucket suite 真实执行时间 ~50%（8h 窗口 12 轮 full-bucket：serial 25% + lowconc 25%）——这些文件被 `// @test-group serial` / `// @test-group lowconc` 标记 load-sensitive、跑降并发（`nproc/(S×P)`）。分类是**每文件顶部自声明**（`grep -rl "@test-group.*serial\|@test-group.*lowconc"` 命中 63 个文件），无集中维护、无「最后核实时间」记录。⛔ 无证据说明现在有错分类，只是该假设从未被系统性复核过。本任务是**抽查复核**，不是直接改降并发配置。

## Plan

抽样一批 serial/lowconc 文件，各在主并发池（不降并发）独立重跑 N 次记录稳定性；稳定候选移出降并发名单（或记录为「复核后保留 + 复核时间」）。

## Acceptance Criteria

- [ ] AC1（能取假，抽查执行）：抽样 ≥N 个 serial/lowconc 文件各在主并发池重跑，记录稳定/不稳定；（⛔ 未抽查 ⇒ 假）。
- [ ] AC2（能取假，结论落地）：稳定候选移出降并发名单，不稳定保留并记录复核时间；（⛔ 稳定文件仍在降并发名单且无复核记录 ⇒ 假）。

## Definition of Done

serial/lowconc 分类复核完成；AC1-2 全勾；过时降并发标注被纠正（或确认无误 + 补复核时间记录）。

## Touches

- 被抽查的 @test-group serial/lowconc 文件（标注调整，如需）
- scripts/test.sh（如需改降并发名单消费）
- plugin/test/...（对应测试，如需）
- tasks/gap-suite-serial-lowconc-classification-recheck.md（自身）