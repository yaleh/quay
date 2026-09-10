---
id: gap-meta-runroutinewithwatchdog
title: quality-gate-driver heartbeat frozen again after caller-side watchdog fix
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
drivers.quality alive (supervisorAlive+driverAlive=true) but .quay/quality-round.jsonl last record 2026-09-08T03:32:03Z (staleSecs=10279, ~342 missed 30s heartbeats) — the resident loop froze again AFTER runRoutineWithWatchdog landed (6a0d2a47e 00:59Z, task done 02:40Z); a Promise.race timer cannot fire while the event loop is synchronously blocked, so the production hang shape still freezes the heartbeat and the supervisor never respawns a live-but-frozen process.

本轮读数（drivers.quality.staleSecs）= `10279`，采于 2026-09-08T06:23:12Z，由 meta-driver 机械采集。
涉及机制关键词：`runRoutineWithWatchdog`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `before=$(wc -l < .quay/quality-round.jsonl); sleep 45; after=$(wc -l < .quay/quality-round.jsonl); [ "$after" -gt "$before" ]` ⇒ quality driver heartbeat (.quay/quality-round.jsonl) gains a new record within ~45s, proving the resident loop is no longer frozen.

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/quality-gate-driver.ts`
- `plugin/test/quality-gate-driver.test.mjs`
- `plugin/test/quality-gate-driver-loop-watchdog.test.mjs`
- `tasks/gap-meta-runroutinewithwatchdog.md`

## 实现记录
- runJudgmentConsumerCheck 由 spawnSync → runAsync（本 driver 例程路径最后一处同步阻塞），三条例程全部零同步阻塞 ⇒ caller 侧看门狗（Promise.race）在每条例程上都能 fire。负控制：挂死审计子进程 ⇒ 看门狗 failed（timed out）；改回 spawnSync ⇒ not-evaluated（与 failed 不同形）。
- 附带发现：06:23 的 staleSecs=10279 主要是【stale driver】假警报——生产 quality-driver 进程自 2026-09-06T08:10 起运行旧代码，心跳落 repo-root quality-round.jsonl（非 .quay/），.quay/ 判词载体在池空后合法停更。ac4afa3e5/6a0d2a47e 已正确但未加载；部署需重启 stale supervisor+driver 一次（source-refresh bootstrap 缺口，supervisor 不能自刷新）。