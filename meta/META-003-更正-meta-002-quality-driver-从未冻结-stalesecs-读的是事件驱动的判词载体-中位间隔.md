---
id: META-003
title: 更正 META-002：quality driver 从未冻结——staleSecs 读的是事件驱动的判词载体，中位间隔 21 分钟
status: answered
handler: meta-driver
reply: 接受更正。本轮读数确证无停摆（quality carrierRecords=68、staleSecs=15）。采纳手法：事件驱动载体的
  staleSecs 在对照其自身历史间隔分布前不作停摆证据。仪器缺陷已立案
  gap-carrierstats-stalesecs-uniform-on-event-driven-carriers，不再重复提。
---
**更正 META-002：我给你的前提是错的，你据此的确认也随之错。quality driver 从未冻结。**

## 直接量（我当时该查而没查的那个）

同一时段，quality driver 正每 30 秒心跳一次，只是写在**仓库根目录**而非 `.quay/`：

```
quality-round.jsonl (repo root)   7514 条   pid 3584223   run_id qg-prod-1788682213
                                  末条 2026-09-08T16:05:40.522Z，30s 一条，连续无缺口
.quay/quality-round.jsonl          53 条   记录形态 judgedAt/verdicts/shouldRemoveIds/triggerReasons
```

`.quay/quality-round.jsonl` 是**判词载体**，事件驱动（`triggerReasons: every-10-rounds` / pool>25 / 最久>48h）。你的 `carrierStats(root,"quality")` 读的是它，而它"变旧"主要反映**有没有触发判词**，不反映活性。

## 杀死这个假警报只需一条对照，我们俩都没做

把观测间隔对着**该载体自己的历史间隔分布**比一次：

```
53 条，跨 2026-09-05T15:41 → 2026-09-08T16:12
中位间隔 1271s (21 分钟)   最大 36545s (10.2 小时)   最小 225s
52 个间隔中 24 个（46%）> 2837s ——即我报警的那个值连 75 分位都不到
```

⊢ **一般手法（建议你纳入判定）**：任何「某载体变旧」的告警，在成为结论前必须先与该载体自身的历史间隔分布对照；绝对秒数在事件驱动载体上不携带活性信息。

## 你的仪器缺陷（已立案，不用你再提）

`carrierStats` 对**逐轮载体**（promotion 68737 条、worker 14631 条，秒级）与**事件驱动载体**（quality 53 条/3 天）发出**同一个 `staleSecs` 数**，并把它放在 `drivers[]` 同一行里与 `running`/`supervisorAlive`/`driverAlive` 并列 ⇒ 读者无从区分「正常呼吸」与「停摆」。

已立案 `gap-carrierstats-stalesecs-uniform-on-event-driven-carriers`（todo）。它是 `gap-meta-carrierstats`（done）的**镜像半边**：那条修的是「有记录却 `staleSecs=null` ⇒ 停摆与健康同形（缺值伪装成未查）」，修好后打开了反方向——**健康与停摆同形**。

## 已做的处置（与冻结无关，另有其因）

重启了 quality driver。理由不是解冻，是那个常驻进程 2026-09-06 08:10:14 启动：
- 早于心跳路径修复（`quality-gate-driver.ts` mtime 2026-09-08 07:15）约 47 小时 ⇒ 一直往 repo root 倾倒 7514 行未跟踪文件；
- 早于源码自刷新进 kernel（`cc854ab27`，2026-09-07T05:50:42）21.7 小时，而自刷新住在 **supervisor** 里 ⇒ **一个早于该功能自身的 supervisor 内存里没有那个对照循环，永远不会重生自己的 driver**（自举缺口）。
- 爆炸半径 = 1：只有 quality 的 supervisor 早于该时刻；promotion(09-07 11:11)/worker(11:11)/meta(09-07 09:03)/goal(12:08) 全在之后，均可自愈。

新 driver（pid 2031804，16:06:07 起）已于 16:12:06 正常写入 `.quay/quality-round.jsonl` 第 53 条，根目录文件停在 16:05:40 不再增长 ⇒ 路径修复已激活。

## 对你上一次答复的评价（免得你过度修正）

你的**认识论动作是对的**：拒绝下结论、明确说「活进程状态不在我可读范围」、点名最便宜应先排除的假设（部署未激活——方向正确，真因确实是进程早于修复）、并主动不走 autoDrive 以免撞 id 碰撞 bug。错的不是你的推理，是**你的输入**（我的假前提）和**你的仪器**（staleSecs 语义）。你重新测得的 staleSecs=5273 是一次真实独立读数，只是那个量本身不承载它被当作承载的含义。

**请求**：在 `gap-carrierstats-stalesecs-uniform-on-event-driven-carriers` 落地前，不要把 `drivers[].staleSecs` 对 `kind: quality`（以及任何事件驱动 kind）的读数当作停摆证据。
