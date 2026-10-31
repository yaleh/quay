---
id: gap-instrument-decay-postlanding-two-rounds
title: instrument-decay 落地后两轮生产复查：同一 pair 第二轮记 already-filed、gap-filing spawn 数不增
status: done
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

- [x] AC1 合入后两个生产轮次中，同一 pair 的第二轮记为 `already-filed`、gap-filing spawn 数不增；贴出两轮 `ts` / `filings`（读 `.quay/quality-round.jsonl`）与窗口起点晚于的落地提交 sha。（已验，2026-10-31）

## DoD

- [x] 上述两轮生产读数已贴出，且与主任务落地提交对齐：两轮 `ts` 与 `filings` 摘自生产 `.quay/quality-round.jsonl`，并附窗口起点晚于的落地提交 sha；不改任何代码。

## Evidence

**2026-10-31 复查轮（worker）：观察窗口已满，AC1 读数成立——同一 pair 第二轮 `already-filed`、spawn 数不增。**

- **前置确认（主任务已合入 develop）**：
  - 实现提交 `d9610e05a4d9647af4122835783ef6b12de6fb7d` 是 develop 祖先：`git merge-base --is-ancestor d9610e05a develop` ⇒ **exit 0**。
  - 落地时刻 = **2026-10-27T04:30:04Z**（提交 `5ead80043`，`tasks: 翻 gap-instrument-decay-dedup-reader-round-log-path done（driver 机械 fan-in）`）。
- **窗口起点晚于落地提交的 instrument-decay 轮次 = 18 个**（2026-10-23 / 2026-10-27 复查时均为 0）：
  生产 `.quay/quality-round.jsonl` 中 `name:"instrument-decay" && ts > "2026-10-27T04:30:04Z"` 的 Fact 共 **18** 个，首个 `2026-10-28T05:35:18.607Z`。
- **同一 pair `fan-in-step-trace.jsonl|rate-stopped` 的前两轮（AC1 核心读数）**：
  - 第一轮 `2026-10-28T05:35:18.607Z`：`filing:"filed"`、`exitCode:0`（触发 1 次 gap-filing spawn）。
  - 第二轮 `2026-10-28T11:31:50.252Z`：`filing:"already-filed"`、`exitCode:null`（去重命中，未再 spawn）。
  ⇒ 同一 pair 的第二轮记为 `already-filed` ✓；`filing:"filed"` 计数第一轮 =1、第二轮 =0，**gap-filing spawn 数不增** ✓。
- **该 pair 后续轮次持续交替 `filed`→`already-filed`（去重读手在生产上持续生效，非一次性）**：
  ```
  2026-10-28T05:35:18.607Z  fan-in-step-trace.jsonl|rate-stopped=filed
  2026-10-28T11:31:50.252Z  fan-in-step-trace.jsonl|rate-stopped=already-filed
  2026-10-28T17:41:06.500Z  fan-in-step-trace.jsonl|rate-stopped=filed
  2026-10-28T23:36:59.695Z  fan-in-step-trace.jsonl|rate-stopped=already-filed
  2026-10-29T05:41:06.444Z  fan-in-step-trace.jsonl|rate-stopped=filed
  2026-10-30T23:32:36.327Z  fan-in-step-trace.jsonl|rate-stopped=filed
  2026-10-31T00:12:09.361Z  fan-in-step-trace.jsonl|rate-stopped=already-filed
  ```
- **历史（2026-10-23 / 2026-10-27 两轮，窗口为空未勾）**：2026-10-23 落地提交不在 develop ⇒ 不勾；2026-10-27 前置已解除但窗口仍 0 轮 ⇒ 补 `depends_on` 关系边并机械停放；窗口自 2026-10-28 起打开，本窗口已满足 AC1。
- 该轴仍暗,理由:本任务零代码改动（DoD 明写「不改任何代码」），无可采的 L_D/L_G 读数。

## Touches

- tasks/gap-instrument-decay-postlanding-two-rounds.md

## Blocker

**2026-10-23T07:35:18.471Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 0/2，剩余未勾 2）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：271673ee-972e-43a9-9f76-5b72128fa4aa