---
id: gap-worker-driver-periodic-exit-resident
title: worker-driver 常驻进程节奏异常（周期性 exit code=0 ~95min + round 间隔异常拉长不动）——查设计内 cadence 还是异常
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 查 stale driver 根因时发现 supervisor log 里 driver 周期性 exit code=0。

**现象（实测 supervisor log）**：`worker-driver-supervisor.log` 里 driver 每 ~95min exit code=0、supervisor 5s 后 respawn：
```
12:34:51  driver exited code=0  →  respawning in 5s → started 362132
14:09:53  driver exited code=0  →  respawning in 5s → started 2039361
```
**常驻循环进程不该自己退出**——除非这是设计内的 supervisor 重启节奏（如「跑 N 轮后主动退出让 supervisor 拉新代码/清内存态」），否则是异常退出（某条件触发 process.exit(0) 或 main 循环自然 return）。

**影响（若异常退出）**：driver 每次 exit 清内存态（round 计数、in-flight set、候选缓存），可能造成派发中断 + stale 态；且 **pre-fix → post-fix 的代码更新正是靠这种退出才生效**（13:21 fan-in 落地 → 14:09 才 respawn 带 fix），若它是意外而非设计节奏，这个「重启窗口」是隐性的、不可预期的。若设计内，则需确认 cadence 合理且文档化。

**第二症状（round 间隔异常拉长，⛔ 非退出是不动，manager 2026-08-23 实测）**：`worker-round.jsonl` 末条 round 14:14:13 → 14:49 共 35min 无新 round，driver 进程 alive（etime 39min）但 round 循环没在正常节奏跑；同时 `load1=13.03 / cpu_stall_avg10=41.63` 偏高（resource-gate-wait 阈值 cpu_limit=60 / loadavg_threshold=32×2）。⇒ 与周期性 exit 同族（常驻循环节奏异常），**调查范围须同时纳入「round 间隔异常拉长（资源闸等待/循环卡住）」不只查 exit**——这可能是「没重派」的真实根因，而非「记录挡重派」。

## Plan

1. 定位 driver exit code=0 的触发条件：读 worker-driver.ts 的 main/常驻循环，查是「跑 N 轮后主动退出」还是「异常 return/未捕获 throw」。
2. **同时查 round 间隔异常拉长**：`worker-round.jsonl` 14:14 后 35min 无新 round 而 driver alive——查常驻循环是否有资源闸等待（resource-gate-wait）或循环卡住的分支，⛔ 不只查 exit。
3. 判定：设计内 ⇒ 文档化 cadence + 判据；异常 ⇒ 修（常驻循环不该退/不该长停）。

## Acceptance Criteria

- [ ] AC1：定位 driver exit code=0 的根因（设计内 cadence 或异常退出，附判别对照：改了 N 或去掉退出后 driver 是否不再周期性退）。

## Definition of Done

- [ ] driver 周期性 exit 根因定位 + 判定（设计内文档化 / 异常修复）；AC1 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/worker-driver.ts（若异常退出，常驻循环修）
- plugin/test/worker-driver.test.mjs（test）
- tasks/gap-worker-driver-periodic-exit-resident.md（自身）
