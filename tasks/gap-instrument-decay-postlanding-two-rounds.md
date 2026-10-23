---
id: gap-instrument-decay-postlanding-two-rounds
title: instrument-decay 落地后两轮生产复查：同一 pair 第二轮记 already-filed、gap-filing spawn 数不增
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-instrument-decay-dedup-reader-round-log-path
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

## Evidence

**2026-10-23 复查轮（worker）：前置未满足，AC/DoD 均未勾，未翻 done。**

- **落地提交未被合入**：`d9610e05a4d9647af4122835783ef6b12de6fb7d`
  （`quality-gate-driver: instrument-decay filing dedup reads <root>/.quay/quality-round.jsonl`，2026-10-23 13:29:36 +0800 = 05:29:36Z）**不在 develop**：
  `git merge-base --is-ancestor d9610e05a develop` ⇒ 非零；
  `git log develop --grep='instrument-decay filing dedup'` ⇒ 0 命中；
  该提交只存在于 `task/gap-instrument-decay-dedup-reader-round-log-path`（tip `442c90ab6`）。
  `git show develop:tasks/gap-instrument-decay-dedup-reader-round-log-path.md` 的 `status:` 仍是 `ready`。
- **窗口起点晚于该提交的 instrument-decay 轮次 = 0**：`.quay/quality-round.jsonl` 共 12 个 `instrument-decay` Fact，
  最后一个在 `2026-10-23T04:00:08.172Z`（早于提交 05:29:36Z）。12 轮全部 `already-filed=0`
  （`filed=2` ×4 / `filed=1` ×8，`deferred=0`）；同一 pair 的第二轮从未在生产上被记为 `already-filed`。
- 故 AC1 要求的「合入后两个生产轮次」尚不存在 ⇒ 不勾任何框，⛔ 不以 external 放行把「尚未发生的观察」记成「已验」。
- 该轴仍暗,理由:本任务零代码改动（DoD 明写「不改任何代码」），无可采的 L_D/L_G 读数。
- **本轮处置**：本任务的前置原先只写在 `## Proposal` 散文里（「只能在主任务合入 develop 之后读取」），
  从未表达为关系边，故它被 promotion-driver 判为四件套完整后直接晋升 `ready` 并进入派发池。
  本轮补上 `depends_on: [gap-instrument-decay-dedup-reader-round-log-path]`（顶层关系边）：
  `ready-pool-check` 的 `depsReadinessFor` 与 worker-driver 的 `depsSatisfied` 共用 `judgeDeps` 读同一字段，
  主任务在 develop 翻 `done` 后该边自动解除、本任务重新可派，届时按 `## Plan` 取两轮读数即可。

## Touches

- tasks/gap-instrument-decay-postlanding-two-rounds.md

## Blocker

**2026-10-23T07:35:18.471Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 0/2，剩余未勾 2）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：271673ee-972e-43a9-9f76-5b72128fa4aa
