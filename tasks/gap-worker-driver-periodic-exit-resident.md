---
id: gap-worker-driver-periodic-exit-resident
title: worker-driver 周期性 exit code=0 是设计内 cadence（前提证伪，重定范围为文档化）——idle-exit +
  supervisor-respawn 写进 CLAUDE.md
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

**结论（2026-08-24 pool-quality-judge，ADR-033——前提证伪，重定范围为文档化）**：本任务原调查问题「worker-driver 周期性 exit code=0 是设计内 cadence 还是异常」**已由代码与 supervisor 设计回答：是设计内 cadence，非异常**：
1. `plugin/scripts/worker-driver.ts:1308`——常驻循环在 `running.length===0`（无在飞 ⇒ 判停或池已排空）时**按设计退出**，返回 0（:1317-1318），从不杀在飞 worker；
2. `plugin/scripts/promotion-driver-launch.sh` run_supervisor 对**任意**退出自动 respawn（~5s），注释「驱动非零退出是常态（被 kill / 异常），不是 supervisor 的错误」，AC139「异常退出（含被 kill）后自动重拉」——idle-exit → respawn 是 run-until-idle 设计节奏，且**代码更新正靠这种退出生效**；
3. round 间隔拉长（35min 无 round 而 driver alive）由**设计内资源闸等待**解释（load1=13.03 / cpu_stall_avg10=41.63 偏高，resource-gate-wait 阈值 cpu_limit=60 / loadavg_threshold=32×2）。

**残余价值**：该 cadence 目前只活在代码注释里，无一处形式化说明——未来观察者可能再次把「driver 周期性 exit code=0 / round 拉长」当作异常重新立案（本任务即由 manager 对 stale driver 根因调查产生）。重定范围后本任务交付：**把 idle-exit + supervisor-respawn 是设计内 cadence 的事实写进 CLAUDE.md driver 节**，附可 grep 判据词，供未来异常检测排除该形态。

## Plan

1. 在 `CLAUDE.md` 「driver 进程管理」节补充：worker-driver 常驻循环在无在飞时**按设计退出**（`running.length===0` ⇒ return 0），supervisor 自动 respawn（~5s）——run-until-idle cadence，非异常；round 间隔拉长由资源闸等待解释。
2. 附带可 grep 判据词 `idle-exit-by-design`，供未来 tick/异常检测排除该形态。

## Acceptance Criteria

- [ ] AC1：`grep -n "idle-exit-by-design" CLAUDE.md` 命中，且该行写明「worker-driver 无在飞 ⇒ 按设计退出 + supervisor respawn，run-until-idle cadence 非异常」。

## Definition of Done

- [ ] AC1 全勾；CLAUDE.md driver 节更新落地到 develop。

## Retires

- 无

## Touches

- CLAUDE.md（driver 进程管理节补设计 cadence 说明）
- tasks/gap-worker-driver-periodic-exit-resident.md（自身）