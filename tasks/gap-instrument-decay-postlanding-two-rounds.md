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

**2026-10-27 复查轮（worker）：前置已解除，但观察窗口仍为空（0/2 轮）——AC/DoD 仍不勾，改为机械停放。**

- **前置（主任务已合入 develop）本轮【已满足】**（上一轮的阻塞理由不再成立）：
  - `git merge-base --is-ancestor d9610e05a develop` ⇒ **exit 0**（是祖先）。
  - 落地时刻 = **2026-10-27T04:30:04Z**：提交 `5ead80043`（`tasks: 翻 gap-instrument-decay-dedup-reader-round-log-path done（driver 机械 fan-in）`，2026-10-27 12:30:04 +0800）；主检出 reflog `5ead80043 author@{2026-10-27 12:30:24 +0800}: merge develop: Fast-forward`。
  - `git show develop:tasks/gap-instrument-decay-dedup-reader-round-log-path.md` ⇒ `status: done`。
  - 生产盘上的代码已带修复：`grep -n resolveRoundLogFile plugin/scripts/quality-gate-driver.ts` ⇒ `:3307`（定义）/ `:3317`（读手）/ `:4327`（写手）；`git rev-list --count develop..author` = **0**、`author..develop` = **0**。
- **窗口起点晚于落地时刻（04:30:04Z）的 instrument-decay 轮次 = 0**：
  生产 `.quay/quality-round.jsonl`（69,154 行）共 **34** 个 `name:"instrument-decay"` Fact；
  最后一个的 `ts` = **`2026-10-27T03:23:09.851Z`**，比落地时刻早 **67 分钟**。
  落地后写入的轮记录（例如 `04:29:54.708Z` / `04:30:32.899Z` / `04:31:13.489Z`）都不含 instrument-decay Fact。
  读数命令（可复跑）：`node -e '…filter f.name==="instrument-decay" && o.ts>"2026-10-27T04:30:04Z"…'` ⇒ `qualifying = 0`。
- **落地前那些重复 `filed` 是预期读数，不是回归**：`fan-in-step-trace.jsonl|rate-stopped` 在 34 轮中出现 24 次且每次 `filed`，
  但修复所在的 `d9610e05a` **直到 2026-10-27T04:30:04Z 才成为 develop 的祖先**——在此之前生产跑的是旧读手，
  这正是主任务描述的缺陷本身，⛔ 不能拿它当作「修了也没用」的证据。
- **去重窗口可行性（估计，不是判据）**：读手只读载体**尾部 500 行**；实测 22:18→03:23 期间追加 215 行 / 5h05m ≈ 42 行/时
  ⇒ 500 行 ≈ 11.8 小时 > 例程 ~5–6 小时间隔 ⇒ 上一轮 instrument-decay Fact 应落在窗口内。
  该算术只是「机制有机会被计量」的上界估计，⛔ 不替代 AC1 要的两轮真实读数。
- **处置**：AC1 要求的是【自然生产轮次】的两轮读数，本轮为 0 轮 ⇒ **不勾 AC1/DoD**，也⛔不手工触发两轮来制造窗口
  （那会绕过「自然节奏下尾部 500 行窗口够不够」这一真正的生产风险，属硬规则 4 推论三的 fixture 变体）。
  窗口打开前每派一个 worker 都会重导出同一读数并烧掉一个会话（本轮即为第 2 次）⇒ 用现成机件 `**PARKED**`
  （`ready-pool-check` 的 `isParked` 逐字排除，见下方 `## Parked` 段）把本任务移出派发池，解除条件可机检。
- 该轴仍暗,理由:本任务零代码改动（DoD 明写「不改任何代码」），无可采的 L_D/L_G 读数。

## Touches

- tasks/gap-instrument-decay-postlanding-two-rounds.md

## Parked

**PARKED** (worker-recorded escalation, 2026-10-27 — execution suspended: the post-landing observation window is still empty).

Why parked: AC1 needs **two natural production instrument-decay rounds** whose window starts after the parent landed on
develop (`2026-10-27T04:30:04Z`). The production carrier currently holds **0** such rounds (last one `2026-10-27T03:23:09.851Z`,
67 min before the landing). Every worker round dispatched before those rounds accrue re-derives exactly this same reading —
this is a **time window**, not a verification gap, and no worker can shorten it without fabricating the observation.

Unpark condition (mechanical): run the check below at the main-checkout root. Unpark (delete the marker line above) once it
reports `qualifying >= 2` **and** the SAME pair's second qualifying round carries `filing=already-filed` while the number of
`filing=filed` entries does not increase between the two rounds. Then execute `## Plan` and paste the two `ts` / `filings`
plus the landing commit sha `d9610e05a4d9647af4122835783ef6b12de6fb7d`.

Check (read-only; prints every qualifying round):

```
node -e 'const fs=require("fs"),T="2026-10-27T04:30:04Z";const r=[];for(const l of fs.readFileSync(".quay/quality-round.jsonl","utf8").split("\n")){if(!l.trim())continue;let o;try{o=JSON.parse(l)}catch{continue}for(const f of (o.facts||[])){if(f.name!=="instrument-decay")continue;if(!(o.ts>T))continue;r.push(o.ts+"  "+((f.value&&f.value.filings)||[]).map(x=>x.key+"="+x.filing).join(" ; "))}}console.log("qualifying="+r.length);console.log(r.join("\n"))'
```

Expected cadence: the routine ran at ~22:18Z / ~00:21Z / ~03:23Z (≈2–6 h apart), so two qualifying rounds are expected within
roughly one routine interval after the landing. Note `qualifying=0` today is the CORRECT reading, not a defect.

## Blocker

**2026-10-23T07:35:18.471Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 0/2，剩余未勾 2）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：271673ee-972e-43a9-9f76-5b72128fa4aa
