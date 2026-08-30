---
id: gap-retrystate-needshuman-no-reconcile-with-disk-ready
title: worker-driver 内存 retryState.needsHuman 与磁盘 ready 翻转对账缺失——人重派被静默忽略；stop_reason backoff 字面量在候选被谓词滤空时误报
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

1. **对账缺失**：`retryState.needsHuman` 只有 `.add()`（driver-filters.ts:161），无 `.delete()`/`.clear()`——进程存活期内只增不减。任务 hit 重试上限进集合后，人把磁盘/develop status 翻回 ready 重派，驱动内存集合不清 ⇒ `retryCapNotExhausted`/`notNeedsHuman` 谓词每轮滤掉 ⇒ 永不重派，直到 driver 重启才恢复。
2. **实证 2026-08-30**：3 任务进集合、人都翻回 ready，驱动仍滤——gap-suite-lpt @09:47、gap-execution-loop @12:28、gap-retire-governance @13:36；15:11–15:59 驱动每 ~40s 一轮 `pool:3 / in_flight:0 / stop_reason:"backoff (all dispatchable candidates are in quick-death backoff)"`，3 候选全滤空、零派发。重启 driver（清内存）后恢复。
3. **误导性 stop_reason（硬规则 3b 同形）**：`worker-driver.ts:2801-2802` 的 "backoff" 字面量在**任何**候选被滤空时打印（`candidates.length===0 && shuffled.length>0`），非仅真快速死亡退避。今日这 3 任务无一次 <60s 快速死亡（worker-outcome 全是 7–46 分钟 exited-not-landed），round 却恒报 backoff。

## Plan

1. markNeedsHuman 落盘后，驱动内存集合应随磁盘 status 翻转对账——磁盘回 ready ⇒ 内存清除（或 driver 每轮重读磁盘 status 取代内存集合判断）。
2. waitReason 区分「候选被谓词滤空」vs「真退避」两个成因，独立取值（⛔ 共用 backoff 字面量）。

## Acceptance Criteria

- [ ] AC1（能取假，对账）：人对已标 needs-human 的任务翻回 ready 后，下一轮驱动即重新可派（不重启即可恢复派发）；（⛔ 仍需重启 ⇒ 假）。
- [ ] AC2（能取假，stop_reason 区分）：候选被谓词滤空与真快速死亡退避的 stop_reason 取值可区分（grep 两处独立字面量）；（⛔ 同字面量 ⇒ 假）。

## Definition of Done

needsHuman 内存集合与磁盘 status 对账；waitReason 区分滤空/退避；AC1-AC2 全勾；全量 suite 绿；人重派不再被静默忽略。

## Touches

- plugin/scripts/driver-filters.ts（needsHuman 对账/清除路径）
- plugin/scripts/worker-driver.ts（waitReason 区分滤空/退避 + needsHuman 重读）
- plugin/test/driver-filters.test.mjs（AC1 单测）
- tasks/gap-retrystate-needshuman-no-reconcile-with-disk-ready.md（自身）
