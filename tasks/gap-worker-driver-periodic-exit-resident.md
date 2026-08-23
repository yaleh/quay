---
id: gap-worker-driver-periodic-exit-resident
title: worker-driver 常驻进程周期性 exit code=0（~95min 一次）——查是设计内 restart cadence 还是异常退出
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

## Plan

1. 定位 driver exit code=0 的触发条件：读 worker-driver.ts 的 main/常驻循环，查是「跑 N 轮后主动退出」还是「异常 return/未捕获 throw」。
2. 判定：设计内 ⇒ 文档化 cadence + 判据；异常 ⇒ 修（常驻循环不该退）。

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
