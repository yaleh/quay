---
id: gap-instrument-decay-postlanding-two-rounds
title: instrument-decay 落地后两轮生产复查：同一 pair 第二轮记 already-filed、gap-filing spawn 数不增
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

主任务 `gap-instrument-decay-dedup-reader-round-log-path` 的实现已落地（提交 `d9610e05a`），但它的「真实落地」复查本质上是 **post-landing 观察**：合入后至少两个生产 instrument-decay 轮次中，同一 pair 的第二轮必须记为 `already-filed`、gap-filing spawn 数不增。这个读数只能在主任务合入 develop 之后从生产 `.quay/quality-round.jsonl` 读取，执行者在落地前无法满足。本跟进任务承载这项复查。

## Plan

1. 确认主任务已合入 develop（记录提交 sha 与时间）。
2. 读取生产 `.quay/quality-round.jsonl` 中窗口起点晚于该提交的两个 instrument-decay 轮次。
3. 断言同一 pair 第二轮 `filing:"already-filed"`，且 gap-filing spawn 数不增。
4. 贴出两轮 `ts` / `filings` 与提交 sha。

## AC

- [ ] AC1 合入后两个生产轮次中，同一 pair 的第二轮记为 `already-filed`、gap-filing spawn 数不增；贴出两轮 `ts` / `filings`（读 `.quay/quality-round.jsonl`）与窗口起点晚于的落地提交 sha。（待外部）

## DoD

- [ ] 上述两轮生产读数已贴出，且与主任务落地提交对齐：两轮 `ts` 与 `filings` 摘自生产 `.quay/quality-round.jsonl`，并附窗口起点晚于的落地提交 sha；不改任何代码。

## Touches

- tasks/gap-instrument-decay-postlanding-two-rounds.md
