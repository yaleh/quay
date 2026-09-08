---
id: gap-carrierstats-stalesecs-uniform-on-event-driven-carriers
title: "[已撤回·前提为假] carrierStats 对事件驱动载体与逐轮载体发同一个 staleSecs——「quality
  是事件驱动载体」实为路径 bug 的产物"
status: superseded
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra:
  schema: execution
---
## 撤回（2026-09-08T16:2xZ，立案后 ~10 分钟）

**本任务的核心前提是假的，撤回，⛔ 不要实现。** 由 `gap-supervisor-never-self-refreshes-no-detector` 接续其中真实的那一半。

**立案时的前提**：`.quay/quality-round.jsonl` 是事件驱动载体（53 条/3 天、中位间隔 1271s、最大 36545s），因此 `carrierStats` 对它与逐轮载体（promotion 68737 条）用同一个 `staleSecs` 语义是缺陷。

**证否它的直接量**（重启 quality driver 后 17 分钟内取得）：该载体开始接收**每 30 秒一条的心跳行**，形态 `['facts','halted','pid','round','run_id','ts']`，条数 53 → 73 且持续增长，`staleSecs` 降到 15。

⊢ quality 载体**本来就是逐轮载体**，与 promotion/worker 同性质。我测到的那个稀疏分布**完全是 `gap-meta-round-log-rel`（心跳写去 repo root 而非 `.quay/`）的产物**——路径 bug 使 `.quay/` 里只剩判词行，我把「被 bug 掏空后的残余」当成了「该载体的天然节奏」。

⊢ `carrierStats` 对所有 kind 统一 staleSecs 语义**是对的，不是缺陷**。

## 教训（这才是本条留存的价值）

**在一个已知有写端缺陷的载体上测出来的分布，不能用来推断该载体的性质。** 我读到 `gap-meta-round-log-rel` 的标题「liveness 监测读判词载体 judgedAt 报假 stall」时，已经知道写端是坏的，却仍用坏写端下的历史数据去刻画「载体天然节奏」并据此立案。

**当场可做的对照（我没做）**：把写端修好（重启进程）**之后**再采一次同一个分布，与修好前对比——两者若不同，说明先前测的是缺陷的形状而不是对象的形状。这个对照事后只花了 17 分钟，且正是它证否了本任务。

⊢ 一般形态：**先问「这个读数是在什么写端状态下取得的」，再谈它刻画了什么。**

## 原始内容（保留供追溯，⛔ 结论已被证否）

原 Proposal 主张 `carrierStats(root, kind)`（`plugin/scripts/driver-runtime.ts:312`）应按载体性质区分 staleSecs 语义，并给了三个方案（cadence 标注 / 相对历史间隔分布判定 / 事件驱动 kind 改用活性直接量）。这些方案针对的问题不存在，故不实现。其中唯一站得住的观察是：**今日确实发生了一次假警报**（我据 staleSecs 402→1622→2837 判为「心跳冻结」并发起 META-002，meta-driver 复核后确认了该读数），但那次假警报的**真因是写端路径 bug + 常驻进程早于修复**，不是读端语义。

## Touches

- `tasks/gap-carrierstats-stalesecs-uniform-on-event-driven-carriers.md`
