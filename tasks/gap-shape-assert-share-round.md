---
id: gap-shape-assert-share-round
title: full-suite-runner 形状断言并轮——一个 fake suite 吐所有 marker 的共享 runner 轮覆盖多条 AC（Tier 2）
status: needs-human
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

~40 个 state/round-record 形状测试各付一次全量 spawn 只断言一个字段；底层解析器已单独单测（:2711–2854）。一个 fake suite 同时吐所有 marker 的**共享 runner 轮**可覆盖多条 AC，把 ~40 次 spawn 并为少数几轮，墙钟显著下降（估 ~15–30s/轮）。

## Plan

1. 识别同形的 state/round-record 形状测试（各自只断言一个字段、共用同一 spawn 解析路径）。
2. 一个共享 fake suite 轮同时吐全部 marker，各测试复用该轮的解析结果。

## Acceptance Criteria

- [ ] AC1（能取假）：形状测试并轮——grep 该文件 spawn 数较基线下降（贴前后计数）；（⛔ spawn 数未降 ⇒ 假）。
- [ ] AC2（能取假）：并轮后每条 AC 断言仍绿（scoped 全绿）；（⛔ 任一条断言丢失/红 ⇒ 假，不删测试换时间）。

## Definition of Done

形状断言共享轮落地：一个 fake suite 同轮吐全部 marker，把 ~40 次 spawn 并为少数几轮；AC1（spawn 数较基线下降）与 AC2（并轮后各断言仍绿）全勾；scoped 全绿且墙钟较基线下降。

## Touches

- plugin/test/full-suite-runner.test.mjs（形状测试并轮）
- tasks/gap-shape-assert-share-round.md（自身）

## Needs-Human

**执行 2026-08-31T03:05:14.459Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
