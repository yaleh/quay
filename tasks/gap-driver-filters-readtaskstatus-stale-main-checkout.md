---
id: gap-driver-filters-readtaskstatus-stale-main-checkout
title: driver-filters.ts readTaskStatus 读主检出陈旧 status——(乙) taskReadRef:develop 漏网实例，notNeedsHuman 滤掉真 ready 任务
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`driver-filters.ts` 的 `readTaskStatus(root, id)` 读 `path.join(root, "tasks", id)`，而 `root = ctx.root` = **主检出（main/manager-doc）**，非 develop（canonical）。主检出落后 develop（实测 8 commits），其上 `tasks/*.md` status 是陈旧快照——实证 2026-08-30：主检出把 gap-execution-loop / gap-continue-cycle 记为 `needs-human`，develop 上真值 `ready`。`notNeedsHuman`（:306）与 `depsSatisfied`（:101 读依赖 status）都经 `readTaskStatus` 消费 ⇒ **notNeedsHuman 把真 ready 任务滤掉**（逐谓词干跑复现：notInFlight/depsSatisfied/touchesDisjoint/retryCapNotExhausted 全 PASS，唯 notNeedsHuman 滤掉两任务），worker `stop_reason` 误报「backoff (all dispatchable candidates in quick-death backoff)」（catch-all 误标签）。**重启无效**（陈旧磁盘 status 非 in-memory）。

**这是 stale-read 族的硬规则 5b 漏网实例**——(乙) `gap-dispatch-reads-stale-main-checkout-task-status`（done）只改 ready-pool-check.ts 读面（`taskReadRef: develop`），`gap-ready-pool-depends-on-status-stale-read`（done）只改 ready-pool-check.ts 的 depends_on 读面，**都没改 driver-filters.ts 的 `readTaskStatus`**。本任务补 driver-filters.ts 这一半。

## Plan

1. driver-filters.ts `readTaskStatus` 改读 develop（复用 ready-pool-check.ts 已落地的 `taskReadRef: develop` / `readTaskStatusAtRef` 手法），notNeedsHuman / depsSatisfied 消费面随之走 develop。⛔ 不得继续读主检出 `ctx.root/tasks`。
2. 全族 grep（硬规则 5b）：枚举所有仍读主检出 `tasks/*.md` status 的派发/晋升谓词（不止 driver-filters.ts、ready-pool-check.ts 两处），逐个确认已迁移或已豁免，命中数与前 3 条贴提交。
3. 负控制：主检出人为置陈旧 `needs-human`、develop 置 `ready`，跑 worker 派发谓词，任务不被滤（notNeedsHuman 放行）。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：driver-filters.ts `readTaskStatus` 读 develop 非主检出——grep 无 `readTaskStatus(ctx.root` 的候选/依赖 status 读，改为 taskReadRef: develop；（⛔ 仍读主检出 ⇒ 假）。
- [ ] AC2（能取假，复现）：主检出 status=needs-human、develop status=ready 时，notNeedsHuman 放行该任务（不复现「滤掉真 ready」）；（⛔ 仍滤 ⇒ 假）。
- [ ] AC3（能取假，全族）：grep 全仓读主检出 tasks status 的派发/晋升谓词，仅剩已迁移/豁免者，命中数贴提交；（⛔ 还有漏网 ⇒ 假）。

## Definition of Done

driver-filters.ts readTaskStatus 读 develop；notNeedsHuman/depsSatisfied 不再读主检出陈旧 status；全族 grep 无漏网；AC1-AC3 全勾；全量 suite 绿。

## Touches

- plugin/scripts/driver-filters.ts（readTaskStatus 读 develop + notNeedsHuman/depsSatisfied 消费面）
- plugin/test/driver-filters.test.mjs（AC2 复现单测）
- tasks/gap-driver-filters-readtaskstatus-stale-main-checkout.md（自身）
