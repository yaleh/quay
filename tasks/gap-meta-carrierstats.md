---
id: gap-meta-carrierstats
title: quality 载体时间戳键 judgedAt 不被 carrierStats 读取——meta-driver 对 quality 的
  staleSecs 恒 null
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
carrierStats 只读记录 j.ts，而 quality-round.jsonl 轮记录用 judgedAt 作时间戳键 ⇒ quality 有 15 条记录却 carrierLastTs=null、staleSecs=null，quality driver 停摆与健康同形（缺值被伪装成未查）

本轮读数（drivers.quality.carrierLastTs）= `null`，采于 2026-09-06T22:38:43Z，由 meta-driver 机械采集。
涉及机制关键词：`carrierStats`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `node --experimental-strip-types -e 'import("./plugin/scripts/driver-runtime.ts").then(m=>{const s=m.carrierStats(process.cwd(),"quality");const ok=!!s.lastTs&&!Number.isNaN(Date.parse(s.lastTs));console.log(JSON.stringify({records:s.records,lastTs:s.lastTs}));process.exit(ok?0:1)})'` ⇒ carrierStats(root,'quality').lastTs 返回可解析的 ISO 时间戳（quality 停摆可被观测到）

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/driver-runtime.ts`
- `plugin/test/driver-runtime.test.mjs`
- `tasks/gap-meta-carrierstats.md`
## Needs-Human

**执行 2026-09-07T00:18:59.405Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=ff: fan-in-ff-merge: FF FAILED (attempt 5 >= 3) — ANTI-LIVELOCK (SPEC §7, gap-ff-livelock-trigger-no-action): develop keeps advancing; escalating + STOPPING automatic retry. Escalation record written to /home/yale/work/quay/.quay/fan-in-ff-escalations.jsonl. Do NOT auto-retry: re-merge develop and re-run the fan-in once develop settles.
fan-in-ff-merge: measure ff_only_locked=false
- run_id：wk-prod-1788717081
- session_id：e6820d61-48dc-4ab3-8401-8402b0ee46a2
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-meta-carrierstats-wk-prod-1788717081.log

## Needs-Human

**执行 2026-09-07T03:24:26.106Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: cpu_ms of equal-CPU-budget files must agree within 200ms (burnSleep=966.6 burnOnly=706.8 diff=259.8) — else cpu_ms is duration-derived
- run_id：wk-prod-1788717081
- session_id：e2748c0b-2bec-43ce-a22d-2aa0f047867c
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-meta-carrierstats~wk-prod-1788717081~1788750475994-61f99d.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-meta-carrierstats-wk-prod-1788717081.log
